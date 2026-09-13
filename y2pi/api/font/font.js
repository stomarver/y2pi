// ================= font.js =================
// RFONT: шрифтовой движок на фреймбуфере (в духе HarfBuzz/Pongo).
// Владеет всем, что касается шрифта: конфигурация и таблица
// кейринга .kern (advances и couples), метрики ячеек, загрузка
// файлов, спрайты глифов и рендеринг ячеек в цвет на канвас.
//
// Формат .kern: font() связывает файл со шрифтом, spacing() задаёт
// ширину пробела, секция advances — поправки символов (i,o):
// i — пустые пиксели перед чернилами, o — пустые пиксели за
// чернилами. Шаг символа = CELL_W + i + o, чернила на перо + i:
// соседи всегда подстраиваются под изменённый символ.
// Секция couples — кернинг пар: XY = (i), сдвиг после X перед Y.
// Все числа со знаком. Пустой или битый конфиг = дефолты.
// Кэши спрайтов живут здесь же; при смене конфига/шрифта Engine
// сбрасывает их через хук onChange.

/**
 * @typedef {Object} KernConfig  Таблица кейринга (.kern)
 * @property {number} spacing  Ширина пробела (может быть <= 0)
 * @property {string} font     Имя шрифта из font()
 * @property {Object<string, {i: number, o: number}>} advances
 * @property {Object<string, number>} couples
 */

/**
 * @typedef {{w: number, rows: number[]}} GlyphShape
 * Форма глифа: строки битовых масок чернил; цвет не участвует,
 * форма одна на все краски.
 */

/**
 * Шрифтовой движок на фреймбуфере: таблица кейринга, метрики,
 * файлы, спрайты глифов и рендеринг ячеек в цвет.
 *
 * @constructor
 * @param {Viewport} view  pix(): метрики ложатся на целые пиксели
 */
function RFONT(view) {
  /** @type {Viewport} */
  this.view = view;
  /** @type {KernConfig} */
  this.kern = RFONT.defaultConfig();
  /** @type {Object<string, HTMLCanvasElement>} */
  this.glyphCache = {};
  /** @type {Object<string, GlyphShape>} */
  this.shapeCache = {};
  /** @type {?function():void} */
  this.onChange = null;  // Engine: невалидация
}

// ---- конфигурация (шрифтовая часть прежнего G) ----

/** @type {string} */
RFONT.FONT = "VGA";
/** @type {string}  Путь от /fonts */
RFONT.FONT_FILE = "VGA/WebPlus_IBM_VGA_8x16.woff";
/** @type {string} */
RFONT.FONT_FALLBACK = "monospace";
/** @type {number}  Ширина символа, px (моноширинность обязательна) */
RFONT.CELL_W = 8;
/** @type {number}  Высота строки, px */
RFONT.CELL_H = 16;
/** @type {number}  Порог альфы глифов: ниже = прозрачный */
RFONT.ALPHA_CUT = 128;

// ---- ячейки: строка как последовательность символов шрифта ----

/**
 * Строка -> ячейки по одной на знакоместо.
 * Любой суррогат (парный или одинокий) становится "?".
 * @param {string} s
 * @returns {string[]}
 */
RFONT.toCells = function (s) {
  var out = [];
  for (var i = 0; i < s.length; i++) {
    var code = s.charCodeAt(i);
    var next = (i + 1 < s.length) ? s.charCodeAt(i + 1) : 0;
    if (code >= 0xD800 && code <= 0xDBFF &&
        next >= 0xDC00 && next <= 0xDFFF) {
      out.push("?");
      i++;
    } else if (code >= 0xD800 && code <= 0xDFFF) {
      out.push("?");
    } else {
      out.push(s[i]);
    }
  }
  return out;
};

/**
 * Все последовательности пробельного схлопываются в один пробел.
 * @param {?string} s
 * @returns {string}
 */
RFONT.cleanText = function (s) {
  return (s || "").replace(/\s+/g, " ");
};

// ---- таблица кейринга (.kern) ----

/** @returns {KernConfig} */
RFONT.defaultConfig = function () {
  return { spacing: RFONT.CELL_W, font: "", advances: {}, couples: {} };
};

RFONT._startsWith = function (s, pre) {
  return String(s).indexOf(pre) === 0;
};

RFONT._stripComment = function (line) {
  var i = line.indexOf("//");
  return i >= 0 ? line.slice(0, i) : line;
};

// Текст между первой "(" и последней ")"
RFONT._valueInParens = function (line) {
  var l = line.indexOf("(");
  var r = line.lastIndexOf(")");
  if (l < 0 || r <= l) return "";
  return line.slice(l + 1, r);
};

// Целое или null: пробелы по краям и "+" у числа допускаются
RFONT._strictInt = function (v) {
  var s = String(v).replace(/^\s+|\s+$/g, "");
  if (!/^[+-]?\d+$/.test(s)) return null;
  return parseInt(s, 10);
};

// Пара целых через разделитель или null (оба или ничего)
RFONT._strictPair = function (body, sep) {
  var parts = String(body).split(sep, 2);
  if (parts.length !== 2) return null;
  var a = RFONT._strictInt(parts[0]);
  var b = RFONT._strictInt(parts[1]);
  if (a === null || b === null) return null;
  return [a, b];
};

// "(i,o)" или null. Скобки обязательны, пробелы допускаются.
// Первое число — перед чернилами, второе — за чернилами.
RFONT._groupPair = function (v) {
  var s = String(v).replace(/^\s+|\s+$/g, "");
  if (s.charAt(0) !== "(" || s.charAt(s.length - 1) !== ")") return null;
  var p = RFONT._strictPair(s.slice(1, -1), ",");
  if (!p) return null;
  return { i: p[0], o: p[1] };
};

// "(i)" или null. Скобки обязательны.
RFONT._groupSingle = function (v) {
  var s = String(v).replace(/^\s+|\s+$/g, "");
  if (s.charAt(0) !== "(" || s.charAt(s.length - 1) !== ")") return null;
  return RFONT._strictInt(s.slice(1, -1));
};

// Группа: символы до первого "=" получают одну пару (i,o).
// Символы (включая скобки) хранятся как есть, повтор бьёт прошлый.
RFONT._applyAdvance = function (cfg, line) {
  var eq = line.indexOf("=");
  if (eq < 0) return;
  var symbols = line.slice(0, eq).replace(/^\s+|\s+$/g, "");
  var pair = RFONT._groupPair(line.slice(eq + 1));
  if (!pair || !symbols) return;
  var cells = RFONT.toCells(symbols);
  for (var i = 0; i < cells.length; i++) {
    cfg.advances[cells[i]] = pair;
  }
};

// Пара: ровно два символа до "=" получают сдвиг (i).
// Повтор бьёт прошлый.
RFONT._applyCouple = function (cfg, line) {
  var eq = line.indexOf("=");
  if (eq < 0) return;
  var symbols = line.slice(0, eq).replace(/^\s+|\s+$/g, "");
  var v = RFONT._groupSingle(line.slice(eq + 1));
  if (v === null) return;
  var cells = RFONT.toCells(symbols);
  if (cells.length !== 2) return;
  cfg.couples[cells[0] + cells[1]] = v;
};

// Имя шрифта: содержимое скобок, крайние кавычки снимаются
RFONT._fontName = function (v) {
  var s = String(v).replace(/^\s+|\s+$/g, "");
  if (s.length >= 2) {
    var q = s.charAt(0), l = s.charAt(s.length - 1);
    if ((q === '"' && l === '"') || (q === "'" && l === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
};

RFONT._applyDirective = function (cfg, line) {
  if (RFONT._startsWith(line, "spacing(")) {
    var sp = RFONT._strictInt(RFONT._valueInParens(line));
    // Ширина пробела, может быть нулевой и отрицательной
    if (sp !== null) cfg.spacing = sp;
  } else if (RFONT._startsWith(line, "font(")) {
    cfg.font = RFONT._fontName(RFONT._valueInParens(line));
  }
  // Всё остальное игнорируется
};

// Парсер никогда не бросает: худший случай = дефолты.
// Секция открывается строкой с именем, закрывается строкой ")"
// или концом файла. Новое имя переключает секцию без закрытия.
/**
 * @param {string} text
 * @returns {KernConfig}
 */
RFONT.parse = function (text) {
  var cfg = RFONT.defaultConfig();
  if (!text) return cfg;
  var raw = String(text).split("\n");
  var section = "";
  for (var i = 0; i < raw.length; i++) {
    var line = RFONT._stripComment(raw[i]).replace(/^\s+|\s+$/g, "");
    if (!line) continue;
    if (RFONT._startsWith(line, "advances")) { section = "advances"; continue; }
    if (RFONT._startsWith(line, "couples")) { section = "couples"; continue; }
    if (line === ")") { section = ""; continue; }
    if (section === "advances") { RFONT._applyAdvance(cfg, line); continue; }
    if (section === "couples") { RFONT._applyCouple(cfg, line); continue; }
    RFONT._applyDirective(cfg, line);
  }
  return cfg;
};

// ---- метрики ----

// Масштаб: размер строки / проектная высота ячейки
RFONT.prototype._scaleK = function (size) {
  return size / RFONT.CELL_H;
};

// Шаг символа в единицах шрифта: пробел — spacing,
// остальные — ячейка + пустые пиксели с обеих сторон чернил
RFONT.prototype._cellBase = function (ch) {
  if (ch === " ") return this.kern.spacing;
  var a = this.kern.advances[ch];
  return RFONT.CELL_W + (a ? a.i + a.o : 0);
};

// Шаг символа в пикселях при размере строки
RFONT.prototype.advanceOf = function (ch, size) {
  return this.view.pix(this._cellBase(ch) * this._scaleK(size));
};

// Сдвиг чернил относительно пера (пустые пиксели перед глифом)
RFONT.prototype.inkOff = function (ch, size) {
  var a = this.kern.advances[ch];
  return this.view.pix((a ? a.i : 0) * this._scaleK(size));
};

// Сдвиг после символа в паре (кернинг) или 0
RFONT.prototype.coupleShift = function (a, b, size) {
  var c = this.kern.couples[a + b];
  return this.view.pix((c || 0) * this._scaleK(size));
};

// Ширина спрайта ячейки: полная проектная ячейка, чернила не режутся
RFONT.prototype.spriteW = function (size) {
  return this.view.pix(RFONT.CELL_W * this._scaleK(size));
};

// Шаги отрезка: шаг символа + сдвиг пары с соседом справа
RFONT.prototype.runAdvances = function (cells, size) {
  var out = [];
  for (var i = 0; i < cells.length; i++) {
    var step = this.advanceOf(cells[i], size);
    if (i + 1 < cells.length) step += this.coupleShift(cells[i], cells[i + 1], size);
    out.push(step);
  }
  return out;
};

// Накопленные смещения: offs[i] = x i-й ячейки, offs[len] = ширина
RFONT.prototype.cumOffsets = function (adv) {
  var out = [0];
  for (var i = 0; i < adv.length; i++) out.push(out[i] + adv[i]);
  return out;
};

// Индекс ячейки под x (x относительно начала отрезка)
RFONT.prototype.charAtX = function (adv, x) {
  var cx = 0, best = 0;
  for (var i = 0; i < adv.length; i++) {
    if (adv[i] > 0 && x >= cx && x < cx + adv[i]) return i;
    if (x >= cx) best = i + 1;
    cx += adv[i];
  }
  return best;
};

// ---- файлы ----

RFONT.prototype._fontURL = function () {
  var s = document.currentScript;
  if (s && s.src) return new URL("../fonts/" + RFONT.FONT_FILE, s.src).href;
  return null;
};

RFONT.prototype._configURL = function () {
  var s = document.currentScript;
  if (!s || !s.src) return null;
  var kern = RFONT.FONT_FILE.replace(/\.[^.]*$/, ".kern");
  return new URL("../fonts/" + kern, s.src).href;
};

// "VGA/WebPlus_IBM_VGA_8x16.woff" -> "WebPlus_IBM_VGA_8x16"
RFONT.baseName = function () {
  var base = RFONT.FONT_FILE.replace(/^.*\//, "");
  return base.replace(/\.[^.]*$/, "");
};

RFONT.prototype.clearCaches = function () {
  this.glyphCache = {};
  this.shapeCache = {};
};

// @font-face + preload; кэш спрайтов сбрасывает Engine через onChange
RFONT.prototype._injectFile = function () {
  var self = this;
  var u = this._fontURL();
  if (!u) return;
  var st = document.createElement("style");
  st.textContent = "@font-face{font-family:\"" + RFONT.FONT +
    "\";src:url(" + u + ") format(\"woff\");}";
  document.head.appendChild(st);
  if (document.fonts && document.fonts.load) {
    var lp = document.fonts.load("16px \"" + RFONT.FONT + "\"");
    // Шрифт мог подгрузиться позже первого кадра:
    // сбрасываем спрайты, чтобы перезапеклись новым шрифтом
    if (lp && lp.then) lp.then(function () { if (self.onChange) self.onChange(); });
  }
};

// Шрифт синхронно, .kern асинхронно; любая неудача = дефолты.
// Файл с чужим font() игнорируется: он для другого шрифта.
/**
 * @param {function():void=} done
 */
RFONT.prototype.load = function (done) {
  this._injectFile();
  var self = this;
  var fin = function () { if (done) done(); };
  var r = this._configURL();
  if (!r || typeof fetch !== "function") { fin(); return; }
  fetch(r).then(function (resp) {
    return resp.ok ? resp.text() : null;
  }).then(function (text) {
    if (typeof text === "string") {
      var cfg = RFONT.parse(text);
      if (!cfg.font || cfg.font === RFONT.baseName()) {
        self.kern = cfg;
        self.clearCaches();
        if (self.onChange) self.onChange();
      }
    }
    fin();
  }, function () { fin(); });
};

// ---- спрайты и формы глифов ----

// Строка шрифта для canvas
RFONT.prototype.labelFont = function (size) {
  return size + "px " + RFONT.FONT + ", " + RFONT.FONT_FALLBACK;
};

// 1-битный спрайт: альфа выше ALPHA_CUT — чернила, иначе прозрачно
RFONT.prototype._makeGlyph = function (ch, size, color) {
  var cw = this.spriteW(size);
  var c = document.createElement("canvas");
  c.width = cw;
  c.height = size;
  var g = c.getContext("2d");
  g.font = this.labelFont(size);
  g.textBaseline = "top";
  g.fillStyle = color;
  g.fillText(ch, 0, 0);
  var img = g.getImageData(0, 0, cw, size);
  var d = img.data;
  for (var i = 3; i < d.length; i += 4) {
    d[i] = (d[i] >= RFONT.ALPHA_CUT) ? 255 : 0;
  }
  g.putImageData(img, 0, 0);
  return c;
};

RFONT.prototype.glyph = function (ch, size, color) {
  var key = size + "|" + color + "|" + ch;
  var s = this.glyphCache[key];
  if (!s) {
    s = this._makeGlyph(ch, size, color);
    this.glyphCache[key] = s;
  }
  return s;
};

RFONT.prototype.glyphShape = function (ch, size) {
  var key = size + "|" + ch;
  var s = this.shapeCache[key];
  if (!s) {
    if (ch === " ") s = { w: this.spriteW(size), rows: [] };
    else {
      var c = this._makeGlyph(ch, size, "#FFFFFF");
      var d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      var rows = [];
      for (var y = 0; y < c.height; y++) {
        var m = 0;
        for (var x = 0; x < c.width; x++) {
          if (d[(y * c.width + x) * 4 + 3] >= RFONT.ALPHA_CUT) m |= (1 << x);
        }
        rows.push(m);
      }
      s = { w: c.width, rows: rows };
    }
    this.shapeCache[key] = s;
  }
  return s;
};

// ---- рендеринг ----

// Ячейки строго по накопленным смещениям: целые координаты, масштаб 1:1.
// Чернила сдвигаются на отступ перед глифом, перо идёт своим шагом.
RFONT.prototype.drawCells = function (ctx, cells, offs, dx, dy, size,
    color, a, b) {
  for (var i = a; i < b; i++) {
    if (cells[i] === " ") continue;
    ctx.drawImage(this.glyph(cells[i], size, color),
      dx + offs[i] + this.inkOff(cells[i], size), dy);
  }
};
