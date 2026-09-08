// ================= r_font.js =================
// Связка шрифта: r_font-конфиг, метрики ячеек, загрузка файлов.
// Формат: font() связывает файл со шрифтом, spacing() задаёт
// ширину пробела, секция advances — поправки символов (i,o):
// i — пустые пиксели перед чернилами, o — пустые пиксели за
// чернилами. Шаг символа = 8 + i + o, чернила на перо + i:
// соседи всегда подстраиваются под изменённый символ.
// Секция couples — кернинг пар: XY = (i), сдвиг после X перед Y.
// Все числа со знаком. Пустой или битый конфиг = дефолты.

// ---- конфиг ----

function defaultR_font() {
  return { spacing: G.CELL_W, font: "", advances: {}, couples: {} };
}

// Живой конфиг: дефолты, пока не приехал r_font
var RC = defaultR_font();

// Строка -> ячейки по одной на знакоместо.
// Любой суррогат (парный или одинокий) становится "?".
function toCells(s) {
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
}

// ---- парсер r_font ----

function startsWith(s, pre) {
  return String(s).indexOf(pre) === 0;
}

function stripComment(line) {
  var i = line.indexOf("//");
  return i >= 0 ? line.slice(0, i) : line;
}

// Текст между первой "(" и последней ")"
function valueInParens(line) {
  var l = line.indexOf("(");
  var r = line.lastIndexOf(")");
  if (l < 0 || r <= l) return "";
  return line.slice(l + 1, r);
}

// Целое или null: пробелы по краям и "+" у числа допускаются
function strictInt(v) {
  var s = String(v).replace(/^\s+|\s+$/g, "");
  if (!/^[+-]?\d+$/.test(s)) return null;
  return parseInt(s, 10);
}

// Пара целых через разделитель или null (оба или ничего)
function strictPair(body, sep) {
  var parts = String(body).split(sep, 2);
  if (parts.length !== 2) return null;
  var a = strictInt(parts[0]);
  var b = strictInt(parts[1]);
  if (a === null || b === null) return null;
  return [a, b];
}

// "(i,o)" или null. Скобки обязательны, пробелы допускаются.
// Первое число — перед чернилами, второе — за чернилами.
function groupPair(v) {
  var s = String(v).replace(/^\s+|\s+$/g, "");
  if (s.charAt(0) !== "(" || s.charAt(s.length - 1) !== ")") return null;
  var p = strictPair(s.slice(1, -1), ",");
  if (!p) return null;
  return { i: p[0], o: p[1] };
}

// "(i)" или null. Скобки обязательны.
function groupSingle(v) {
  var s = String(v).replace(/^\s+|\s+$/g, "");
  if (s.charAt(0) !== "(" || s.charAt(s.length - 1) !== ")") return null;
  return strictInt(s.slice(1, -1));
}

// Группа: символы до первого "=" получают одну пару (i,o).
// Символы (включая скобки) хранятся как есть, повтор бьёт прошлый.
function applyAdvance(cfg, line) {
  var eq = line.indexOf("=");
  if (eq < 0) return;
  var symbols = line.slice(0, eq).replace(/^\s+|\s+$/g, "");
  var pair = groupPair(line.slice(eq + 1));
  if (!pair || !symbols) return;
  var cells = toCells(symbols);
  for (var i = 0; i < cells.length; i++) {
    cfg.advances[cells[i]] = pair;
  }
}

// Пара: ровно два символа до "=" получают сдвиг (i).
// Повтор бьёт прошлый.
function applyCouple(cfg, line) {
  var eq = line.indexOf("=");
  if (eq < 0) return;
  var symbols = line.slice(0, eq).replace(/^\s+|\s+$/g, "");
  var v = groupSingle(line.slice(eq + 1));
  if (v === null) return;
  var cells = toCells(symbols);
  if (cells.length !== 2) return;
  cfg.couples[cells[0] + cells[1]] = v;
}

// Имя шрифта: содержимое скобок, крайние кавычки снимаются
function fontName(v) {
  var s = String(v).replace(/^\s+|\s+$/g, "");
  if (s.length >= 2) {
    var q = s.charAt(0), l = s.charAt(s.length - 1);
    if ((q === '"' && l === '"') || (q === "'" && l === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}

function applyDirective(cfg, line) {
  if (startsWith(line, "spacing(")) {
    var sp = strictInt(valueInParens(line));
    // Ширина пробела, может быть нулевой и отрицательной
    if (sp !== null) cfg.spacing = sp;
  } else if (startsWith(line, "font(")) {
    cfg.font = fontName(valueInParens(line));
  }
  // Всё остальное игнорируется
}

// Парсер никогда не бросает: худший случай = дефолты.
// Секция открывается строкой с именем, закрывается строкой ")"
// или концом файла. Новое имя переключает секцию без закрытия.
function parseR_font(text) {
  var cfg = defaultR_font();
  if (!text) return cfg;
  var raw = String(text).split("\n");
  var section = "";
  for (var i = 0; i < raw.length; i++) {
    var line = stripComment(raw[i]).replace(/^\s+|\s+$/g, "");
    if (!line) continue;
    if (startsWith(line, "advances")) { section = "advances"; continue; }
    if (startsWith(line, "couples")) { section = "couples"; continue; }
    if (line === ")") { section = ""; continue; }
    if (section === "advances") { applyAdvance(cfg, line); continue; }
    if (section === "couples") { applyCouple(cfg, line); continue; }
    applyDirective(cfg, line);
  }
  return cfg;
}

// ---- метрики ----

// Масштаб: размер строки / проектная высота ячейки
function scaleK(size) {
  return size / G.CELL_H;
}

// Шаг символа в единицах шрифта: пробел — spacing,
// остальные — ячейка + пустые пиксели с обеих сторон чернил
function cellBase(ch) {
  if (ch === " ") return RC.spacing;
  var a = RC.advances[ch];
  return G.CELL_W + (a ? a.i + a.o : 0);
}

// Шаг символа в пикселях при размере строки
function advanceOf(ch, size) {
  return pix(cellBase(ch) * scaleK(size));
}

// Сдвиг чернил относительно пера (пустые пиксели перед глифом)
function inkOff(ch, size) {
  var a = RC.advances[ch];
  return pix((a ? a.i : 0) * scaleK(size));
}

// Сдвиг после символа в паре (кернинг) или 0
function coupleShift(a, b, size) {
  var c = RC.couples[a + b];
  return pix((c || 0) * scaleK(size));
}

// Ширина спрайта ячейки: полная проектная ячейка, чернила не режутся
function spriteW(size) {
  return pix(G.CELL_W * scaleK(size));
}

// Шаги отрезка: шаг символа + сдвиг пары с соседом справа
function runAdvances(cells, size) {
  var out = [];
  for (var i = 0; i < cells.length; i++) {
    var step = advanceOf(cells[i], size);
    if (i + 1 < cells.length) step += coupleShift(cells[i], cells[i + 1], size);
    out.push(step);
  }
  return out;
}

// Накопленные смещения: offs[i] = x i-й ячейки, offs[len] = ширина
function cumOffsets(adv) {
  var out = [0];
  for (var i = 0; i < adv.length; i++) out.push(out[i] + adv[i]);
  return out;
}

// Индекс ячейки под x (x относительно начала отрезка)
function charAtX(adv, x) {
  var cx = 0, best = 0;
  for (var i = 0; i < adv.length; i++) {
    if (adv[i] > 0 && x >= cx && x < cx + adv[i]) return i;
    if (x >= cx) best = i + 1;
    cx += adv[i];
  }
  return best;
}

// ---- файлы ----

function fontURL() {
  var s = document.currentScript;
  if (s && s.src) return new URL("../fonts/" + G.FONT_FILE, s.src).href;
  return null;
}

function r_fontURL() {
  var s = document.currentScript;
  if (!s || !s.src) return null;
  var rf = G.FONT_FILE.replace(/\.[^.]*$/, ".r_font");
  return new URL("../fonts/" + rf, s.src).href;
}

// "VGA/WebPlus_IBM_VGA_8x16.woff" -> "WebPlus_IBM_VGA_8x16"
function fontBaseName() {
  var base = G.FONT_FILE.replace(/^.*\//, "");
  return base.replace(/\.[^.]*$/, "");
}

function injectFontFile() {
  var u = fontURL();
  if (!u) return;
  var st = document.createElement("style");
  st.textContent = "@font-face{font-family:\"" + G.FONT +
    "\";src:url(" + u + ") format(\"woff\");}";
  document.head.appendChild(st);
  if (document.fonts && document.fonts.load) {
    var lp = document.fonts.load("16px \"" + G.FONT + "\"");
    // Шрифт мог подгрузиться позже первого кадра:
    // сбрасываем спрайты, чтобы перезапеклись новым шрифтом
    if (lp && lp.then) lp.then(function () { glyphCache = {}; shapeCache = {}; dirty = true; });
  }
}

// Шрифт синхронно, r_font асинхронно; любая неудача = дефолты.
// Файл с чужим font() игнорируется: он для другого шрифта.
function loadFont(done) {
  injectFontFile();
  var fin = function () { if (done) done(); };
  var r = r_fontURL();
  if (!r || typeof fetch !== "function") { fin(); return; }
  fetch(r).then(function (resp) {
    return resp.ok ? resp.text() : null;
  }).then(function (text) {
    if (typeof text === "string") {
      var cfg = parseR_font(text);
      if (!cfg.font || cfg.font === fontBaseName()) {
        RC = cfg;
        glyphCache = {};
        shapeCache = {};
        dirty = true;
      }
    }
    fin();
  }, function () { fin(); });
}
