// ================= render.js =================
// Кадр: раскладка строк, подчёркивание, ссылки, сборка сцены.
// Текст рисуется спрайтами RFONT: Renderer не знает, что такое
// глиф, — шаги и смещения спрашивает у rfont, ячейки в цвет
// рисует rfont.drawCells; цвет выбирает по ролям и теме.
// Состояние выделения живёт в Selection: на кадр берётся снимок
// (selection.beginFrame/snapshot), позиции указателя — из
// регистра pointer (пишет Input). Перерисовка — по флагу dirty.

/**
 * @typedef {Object} RunGeo  Раскладка отрезка в кадре
 * @property {Run} run
 * @property {number} x
 * @property {number} w
 * @property {number[]} adv
 */

/**
 * @typedef {Object} RowGeo  Раскладка строки в кадре
 * @property {number} y  В координатах контента
 * @property {number} h
 * @property {RunGeo[]} runs
 */

/**
 * @typedef {Object} LinkHit  Область ссылки для хит-тестов
 * @property {number} x
 * @property {number} y  В координатах контента
 * @property {number} w
 * @property {number} h
 * @property {string} url
 */

/**
 * Рендерер: строит кадр из блоков сцены, ведёт раскладку и
 * хит-зоны ссылок, держит память посещённых ссылок.
 *
 * @constructor
 * @param {RFONT} rfont
 * @param {Palette} palette
 * @param {Viewport} view
 * @param {Scene} scene
 * @param {Debug} debug
 * @param {{x: number, y: number}} pointer  Регистр указателя, пишем Input
 */
function Renderer(rfont, palette, view, scene, debug, pointer) {
  /** @type {RFONT} */
  this.rfont = rfont;
  /** @type {Palette} */
  this.palette = palette;
  /** @type {Viewport} */
  this.view = view;
  /** @type {Scene} */
  this.scene = scene;
  /** @type {Debug} */
  this.debug = debug;
  /** @type {{x: number, y: number}} */
  this.pointer = pointer;
  /** @type {Selection} */
  this.selection = null;  // Engine подключает после создания
  /** @type {boolean} */
  this.dirty = true;
  /** @type {RowGeo[]} */
  this.layout = [];
  /** @type {LinkHit[]} */
  this.links = [];
  /** @type {Object<string, true>} */
  this.visited = Object.create(null);
  /** @type {?string} */
  this._hoverUrl = null;
  /** @type {?string} */
  this._cursor = null;
}

// Посещённые ссылки живут в браузере: переживают перезагрузку.
Renderer.VISITED_KEY = "pixel.visited";

Renderer.prototype.invalidate = function () {
  this.dirty = true;
};

// ---- посещённые ссылки ----
// Любая неудача хранилища молча игнорируется.

Renderer.prototype.loadVisited = function () {
  try {
    if (typeof localStorage === "undefined") return;
    var list = JSON.parse(localStorage.getItem(Renderer.VISITED_KEY) || "[]");
    for (var i = 0; i < list.length; i++) this.visited[list[i]] = true;
  } catch (e) {}
};

Renderer.prototype.rememberVisit = function (url) {
  this.visited[url] = true;
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(Renderer.VISITED_KEY,
      JSON.stringify(Object.keys(this.visited)));
  } catch (e) {}
};

// ---- подчёркивание ----

// Подчёркивание: на пиксель выше низа ячейки
Renderer.prototype._underlineY = function (dy, size) {
  return dy + size - G.UNDERLINE_H - 1;
};

// Вырез отрезка: колонка x закрыта, если в окне 3x3 вокруг (x, uy)
// есть чернила. Невидимый ореол ровно 1px в каждую из 8 сторон:
// вырезает только подчёркивание, на остальное не влияет.
Renderer.prototype._lineCut = function (cells, offs, dx, dy, size, uy) {
  var rfont = this.rfont;
  var gs = [];
  for (var i = 0; i < cells.length; i++) {
    gs.push({ s: rfont.glyphShape(cells[i], size),
      gx: dx + offs[i] + rfont.inkOff(cells[i], size) });
  }
  return function (x) {
    for (var i = 0; i < gs.length; i++) {
      var g = gs[i], lx = x - g.gx;
      if (lx < -1 || lx > g.s.w) continue;
      for (var r = uy - 1; r <= uy + 1; r++) {
        var ly = r - dy;
        if (ly < 0 || ly >= g.s.rows.length) continue;
        var m = g.s.rows[ly];
        for (var b = lx - 1; b <= lx + 1; b++) {
          if (b >= 0 && b < g.s.w && (m & (1 << b))) return true;
        }
      }
    }
    return false;
  };
};

// Линия с вырезами под чернилами: колонки, закрытые ореолом (cut),
// пропускаются. Короче диапазона на 1px справа (захардкожено,
// как у выделения слева). Видимые пиксели пакетируются в отрезки.
Renderer.prototype._segLine = function (ctx, x0, x1, uy, cut) {
  var rx = -1;
  for (var x = x0; x < x1 - 1; x++) {
    if (cut(x)) {
      if (rx >= 0) { ctx.fillRect(rx, uy, x - rx, G.UNDERLINE_H); rx = -1; }
    } else if (rx < 0) rx = x;
  }
  if (rx >= 0) ctx.fillRect(rx, uy, x1 - 1 - rx, G.UNDERLINE_H);
};

// Черта отрезка во всю ширину с вырезами под чернилами
Renderer.prototype._strokeRun = function (ctx, run, g, dx, dy, size, color) {
  ctx.fillStyle = color;
  var uy = this._underlineY(dy, size);
  this._segLine(ctx, dx, dx + g.w, uy,
    this._lineCut(run.cells, g.offs, dx, dy, size, uy));
};

// ---- кадр ----

Renderer.prototype.beginFrame = function () {
  this.links = [];
  this.layout = [];
  this._hoverUrl = null;
  this.selection.beginFrame();
  var ctx = this.view.ctx;
  if (!ctx) return false;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = this.palette.current.bg;
  ctx.fillRect(0, 0, this.view.viewW, this.view.viewH);
  return true;
};

Renderer.prototype.updateCursor = function () {
  var cv = this.view.cv;
  if (!cv) return;
  if (this._hoverUrl !== this._cursor) {
    this._cursor = this._hoverUrl;
    cv.style.cursor = this._hoverUrl ? "pointer" : "default";
  }
};

// Ссылка под точкой в координатах контента или null
Renderer.prototype.linkAt = function (x, y) {
  for (var i = 0; i < this.links.length; i++) {
    var L = this.links[i];
    if (x >= L.x && x < L.x + L.w && y >= L.y && y < L.y + L.h) return L.url;
  }
  return null;
};

Renderer.prototype._drawRule = function (ctx, y) {
  ctx.fillStyle = this.palette.current.rule;
  ctx.fillRect(G.SAFE_MARGIN, this.view.pix(y),
    Math.max(0, this.view.viewW - G.SAFE_MARGIN * 2), G.RULE_H);
};

// ---- строки ----

// Цвет отрезка: явный data-color бьёт всё; ссылки хранят свои цвета
// (тусклая, но кликабельная ссылка была бы ложью); дальше inactive,
// дальше роль строки.
// Токен "U<id>" раскрывается текущей темой, hex проходит как есть.
Renderer.prototype.runColor = function (run, role) {
  if (run.color) return Palette.resolve(run.color);
  if (run.url) return this.visited[run.url]
    ? this.palette.current.visited : this.palette.current.link;
  if (run.inactive) return this.palette.current.inactive;
  return (role === "bright") ? this.palette.current.bright
                             : this.palette.current.text;
};

// Строка из отрезков. Роль цвета: "text" или "bright".
// Геометрию пишем в layout[rowIdx] для выделения и хит-тестов.
Renderer.prototype.drawRuns = function (ctx, runs, x, y, size, center,
    role, rowIdx) {
  var view = this.view;
  var dy = view.pix(y);
  if (!runs.length) {
    this.layout[rowIdx] = { y: dy + view.scrollY, h: size, runs: [] };
    return;
  }
  var rfont = this.rfont;
  var gs = [], total = 0, i;
  for (i = 0; i < runs.length; i++) {
    var adv = rfont.runAdvances(runs[i].cells, size);
    var offs = rfont.cumOffsets(adv);
    gs.push({ adv: adv, offs: offs, w: offs[offs.length - 1] });
    total += offs[offs.length - 1];
  }
  // Центрирование всегда в пол: нечётная ширина — приоритет левой стороне
  var dx = center ? Math.floor((view.viewW - total) / 2) : view.pix(x);
  var geo = [];
  for (i = 0; i < runs.length; i++) {
    geo.push({ run: runs[i], x: dx, w: gs[i].w, adv: gs[i].adv });
    if (runs[i].url) this.drawRunLink(ctx, runs[i], gs[i], dx, dy, size,
      rowIdx, i, runs[i - 1] || null, runs[i + 1] || null);
    else this.drawRunText(ctx, runs[i], gs[i], dx, dy, size, role,
      rowIdx, i, runs[i - 1] || null, runs[i + 1] || null);
    if (this.debug.halo) this.drawHalo(ctx, runs[i].cells, gs[i].offs,
      dx, dy, size);
    dx += gs[i].w;
  }
  this.layout[rowIdx] = { y: dy + view.scrollY, h: size, runs: geo };
};

// Отрезок с выделением [a, b): подложка + три куска текста.
// Подчёркивание идёт по сегментам в цвет текста под ним.
Renderer.prototype._drawSelectedText = function (ctx, cells, offs, dx, dy,
    size, color, a, b, underlined, cuts) {
  // Выделение шире диапазона на 1px влево (захардкожено),
  // краевые пробелы подрезаются со стороны неподсвеченного соседа
  var x0 = dx + offs[a] - 1 + cuts.l, x1 = dx + offs[b] - cuts.r;
  ctx.fillStyle = this.palette.current.bright;
  ctx.fillRect(x0, dy, Math.max(0, x1 - x0), size);
  this.rfont.drawCells(ctx, cells, offs, dx, dy, size, color, 0, a);
  this.rfont.drawCells(ctx, cells, offs, dx, dy, size,
    this.palette.current.bg, a, b);
  this.rfont.drawCells(ctx, cells, offs, dx, dy, size, color, b, cells.length);
  if (underlined) {
    // Черта не следует за левым пикселем подложки: остаётся на месте
    var uy = this._underlineY(dy, size);
    var cut = this._lineCut(cells, offs, dx, dy, size, uy);
    ctx.fillStyle = color;
    this._segLine(ctx, dx + offs[0], dx + offs[a], uy, cut);
    this._segLine(ctx, dx + offs[b], dx + offs[cells.length], uy, cut);
    ctx.fillStyle = this.palette.current.bg;
    this._segLine(ctx, dx + offs[a], dx + offs[b], uy, cut);
  }
};

Renderer.prototype.drawRunText = function (ctx, run, g, dx, dy, size, role,
    rowIdx, runIdx, prev, next) {
  var color = this.runColor(run, role);
  var sel = this.selection;
  var span = sel.spanFor(rowIdx, runIdx, run.cells.length, run.unselectable);
  if (span) {
    this._drawSelectedText(ctx, run.cells, g.offs, dx, dy, size, color,
      span.a, span.b, run.underlined,
      sel._spaceCuts(rowIdx, runIdx, run, prev, next, span.a, span.b));
  } else {
    this.rfont.drawCells(ctx, run.cells, g.offs, dx, dy, size, color,
      0, run.cells.length);
    if (run.underlined) this._strokeRun(ctx, run, g, dx, dy, size, color);
  }
};

// Ссылка, свой рендеринг: цвет, по наведению инверсия
// (подавляется активным выделением), посещённая другим цветом.
// Подчёркивание только по флагу и всегда в цвет текста под ним.
Renderer.prototype.drawRunLink = function (ctx, run, g, dx, dy, size,
    rowIdx, runIdx, prev, next) {
  var color = this.runColor(run); // роль не нужна: ссылка уходит цветом по url раньше неё
  var sel = this.selection;
  var hover = !sel.snapshot() && (this.pointer.x >= dx &&
               this.pointer.x < dx + g.w &&
               this.pointer.y >= dy && this.pointer.y < dy + size);
  var span = sel.spanFor(rowIdx, runIdx, run.cells.length, run.unselectable);
  if (hover) {
    // Подложка шире на 1px влево, как у выделения; черта остаётся на месте
    if (g.w > 0) {
      ctx.fillStyle = color;
      ctx.fillRect(dx - 1, dy, g.w + 1, size);
    }
    this.rfont.drawCells(ctx, run.cells, g.offs, dx, dy, size,
      this.palette.current.bg, 0, run.cells.length);
    if (run.underlined) this._strokeRun(ctx, run, g, dx, dy, size,
      this.palette.current.bg);
    this._hoverUrl = run.url;
  } else if (span) {
    this._drawSelectedText(ctx, run.cells, g.offs, dx, dy, size, color,
      span.a, span.b, run.underlined,
      sel._spaceCuts(rowIdx, runIdx, run, prev, next, span.a, span.b));
  } else {
    this.rfont.drawCells(ctx, run.cells, g.offs, dx, dy, size, color,
      0, run.cells.length);
    if (run.underlined) this._strokeRun(ctx, run, g, dx, dy, size, color);
  }
  this.links.push({ x: dx, y: dy + this.view.scrollY, w: g.w, h: size,
    url: run.url });
};

// ---- debug-отрисовка: ореолы и бейдж ----

// Видимый ореол: кольцо вокруг чернил в цвет magenta наоборот теме.
// Сами чернила не закрашиваются, текст остаётся читаемым.
// Ореол рисуется тем же окном 3x3, что вырезает подчёркивание.
Renderer.prototype.drawHalo = function (ctx, cells, offs, dx, dy, size) {
  var rfont = this.rfont;
  ctx.fillStyle = G.NEGATIVE ? Palette.TABLE[5] : Palette.TABLE[13];
  for (var i = 0; i < cells.length; i++) {
    if (cells[i] === " ") continue;
    var s = rfont.glyphShape(cells[i], size);
    var gx = dx + offs[i] + rfont.inkOff(cells[i], size);
    for (var ly = 0; ly < s.rows.length; ly++) {
      var m = s.rows[ly];
      if (!m) continue;
      for (var lx = 0; lx < s.w; lx++) {
        if (!(m & (1 << lx))) continue;
        for (var ay = -1; ay <= 1; ay++) {
          for (var ax = -1; ax <= 1; ax++) {
            if (!ax && !ay) continue;
            var nx = lx + ax, ny = ly + ay;
            if (nx >= 0 && nx < s.w && ny >= 0 && ny < s.rows.length &&
                (s.rows[ny] & (1 << nx))) continue;
            ctx.fillRect(gx + nx, dy + ny, 1, 1);
          }
        }
      }
    }
  }
};

// Бейдж режима: слово debug в самом правом нижнем углу кадрового буфера
// (не страницы: от скролла не зависит; без отступов). Подложка по правилам
// выделения, в раскладку не попадает — выделить и скопировать нельзя.
Renderer.prototype.drawDebugBadge = function (ctx) {
  var rfont = this.rfont;
  var cells = RFONT.toCells("debug");
  var adv = rfont.runAdvances(cells, RFONT.CELL_H);
  var offs = rfont.cumOffsets(adv);
  var w = offs[offs.length - 1];
  var dx = this.view.viewW - w;
  var dy = this.view.viewH - RFONT.CELL_H;
  ctx.fillStyle = this.palette.current.bright;
  ctx.fillRect(dx - 1, dy, w + 1, RFONT.CELL_H);
  this.rfont.drawCells(ctx, cells, offs, dx, dy, RFONT.CELL_H,
    this.palette.current.bg, 0, cells.length);
};

// ---- сцена ----

Renderer.prototype.frame = function () {
  if (!this.dirty) return;
  if (!this.beginFrame()) return;
  this.dirty = false;
  var ctx = this.view.ctx;
  var view = this.view;
  var M = G.SAFE_MARGIN;
  var y = M - view.scrollY;
  var row = 0;
  for (var i = 0; i < this.scene.blocks.length; i++) {
    var b = this.scene.blocks[i];
    if (b.type === "rule") {
      this._drawRule(ctx, y);
      y += G.RULE_H + G.BLOCK_GAP;
    } else if (b.type === "list") {
      for (var j = 0; j < b.items.length; j++) {
        var it = b.items[j];
        this.drawRuns(ctx, it.runs, M, y, RFONT.CELL_H, it.center, "text",
          row);
        row++;
        y += RFONT.CELL_H + G.ITEM_GAP;
      }
      y += Math.max(0, G.BLOCK_GAP - G.ITEM_GAP);
    } else {
      this.drawRuns(ctx, b.runs, M, y, b.size, b.center, b.role, row);
      row++;
      y += b.size + G.BLOCK_GAP;
    }
  }
  view.contentH = y + view.scrollY;
  view.clamp();
  if (this.debug.on) this.drawDebugBadge(ctx);
  this.updateCursor();
};
