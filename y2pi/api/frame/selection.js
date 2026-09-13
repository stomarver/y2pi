// ================= selection.js =================
// Выделение: концы { row, run, ch } в координатах документа,
// хит-тест по раскладке, словесное и блочное выделение, копирование.
// Снимок кадра (beginFrame/snapshot) читает Renderer во время
// отрисовки: layout там частично заполнен, живые концы не подойдут.
// Невыделяемый отрезок не выбирается никогда.

/**
 * @typedef {Object} SelPos
 * @property {number} row
 * @property {number} run
 * @property {number} ch
 */

/**
 * @typedef {{a: SelPos, b: SelPos}} SelRange
 */

/**
 * Выделение: концы якоря, операции (слова, блок, всё), копирование.
 *
 * @constructor
 * @param {Renderer} renderer  источник раскладки (layout)
 * @param {RFONT} rfont  charAtX
 */
function Selection(renderer, rfont) {
  /** @type {Renderer} */
  this.renderer = renderer;
  /** @type {RFONT} */
  this.rfont = rfont;
  /** @type {?SelPos} */
  this.anchor = null;
  /** @type {?SelPos} */
  this.focus = null;
  /** @type {boolean} */
  this.selecting = false;
  /** @type {?SelRange} */
  this._frame = null;
}

// Класс символа для словесного выделения: 0 пробел, 1 слово, 2 прочее
Selection._charClass = function (c) {
  if (c === " ") return 0;
  if (/[A-Za-z0-9_\u0400-\u04FF]/.test(c)) return 1;
  return 2;
};

// ---- концы и снимки ----

Selection.prototype._cmp = function (p, q) {
  if (p.row !== q.row) return p.row - q.row;
  if (p.run !== q.run) return p.run - q.run;
  return p.ch - q.ch;
};

// Упорядоченная непустая пара концов или null
Selection.prototype.current = function () {
  if (!this.anchor || !this.focus) return null;
  var a = this.anchor, b = this.focus;
  if (this._cmp(a, b) > 0) { var t = a; a = b; b = t; }
  if (this._cmp(a, b) === 0) return null;
  return { a: a, b: b };
};

// Снимок на кадр: отрисовка читает только его
Selection.prototype.beginFrame = function () {
  this._frame = this.current();
};

// Снимок текущего кадра (null, если выделение пусто)
Selection.prototype.snapshot = function () {
  return this._frame;
};

/** @param {SelPos} p */
Selection.prototype.reset = function (p) {
  this.anchor = p;
  this.focus = p;
};

/**
 * Выбранный диапазон ячеек отрезка или null.
 * @param {number} row
 * @param {number} run
 * @param {number} len
 * @param {boolean} unselectable
 * @returns {?{a: number, b: number}}
 */
Selection.prototype.spanFor = function (row, run, len, unselectable) {
  var s = this._frame;
  if (!s || unselectable) return null;
  if (row < s.a.row || row > s.b.row) return null;
  var runA = (row === s.a.row) ? s.a.run : 0;
  var runB = (row === s.b.row) ? s.b.run : 1000000;
  if (run < runA || run > runB) return null;
  var a = (row === s.a.row && run === s.a.run) ? s.a.ch : 0;
  var b = (row === s.b.row && run === s.b.run) ? s.b.ch : len;
  if (a < 0) a = 0;
  if (b > len) b = len;
  if (a >= b) return null;
  return { a: a, b: b };
};

// Покрывает ли выбор ячейку ch соседнего отрезка.
// Читает только сцену и снимок кадра, не раскладку.
Selection.prototype._covers = function (row, idx, run, ch) {
  if (!run) return false;
  var s = this.spanFor(row, idx, run.cells.length, run.unselectable);
  return !!s && ch >= s.a && ch < s.b;
};

// Подрезка пробелов на краях выбранного [a, b): пробел уже на 1px
// со стороны, где соседняя ячейка не подсвечена.
Selection.prototype._spaceCuts = function (row, idx, run, prev, next, a, b) {
  var cuts = { l: 0, r: 0 };
  if (run.cells[a] === " ") {
    var pl = prev ? prev.cells.length - 1 : 0;
    if (a > 0 || !this._covers(row, idx - 1, prev, pl)) cuts.l = 1;
  }
  if (run.cells[b - 1] === " ") {
    if (b < run.cells.length || !this._covers(row, idx + 1, next, 0)) cuts.r = 1;
  }
  return cuts;
};

// ---- позиции и операции ----

// Ячейки отрезка в раскладке
Selection.prototype._runCells = function (row, run) {
  return this.renderer.layout[row].runs[run].run.cells;
};

// Документная позиция под точкой (x, y в координатах контента)
Selection.prototype.pickAt = function (x, y) {
  var layout = this.renderer.layout;
  if (!layout.length) return null;
  var r = 0;
  for (var i = 0; i < layout.length; i++) {
    r = i;
    if (y < layout[i].y + layout[i].h) break;
  }
  var L = layout[r];
  if (!L.runs.length) return { row: r, run: 0, ch: 0 };
  var run = 0;
  for (var j = 0; j < L.runs.length; j++) {
    run = j;
    if (x < L.runs[j].x + L.runs[j].w) break;
  }
  var R = L.runs[run];
  return { row: r, run: run, ch: this.rfont.charAtX(R.adv, x - R.x) };
};

// Выделить всё
Selection.prototype.selectAll = function () {
  var layout = this.renderer.layout;
  if (!layout.length) return;
  this.anchor = { row: 0, run: 0, ch: 0 };
  var last = layout.length - 1;
  var L = layout[last];
  if (!L.runs.length) {
    this.focus = { row: last, run: 0, ch: 0 };
  } else {
    var R = L.runs[L.runs.length - 1];
    this.focus = { row: last, run: L.runs.length - 1, ch: R.run.cells.length };
  }
  this.renderer.invalidate();
};

// Слово под позицией: расширяемся в классе символа (Selection._charClass)
// через отрезки.
// Невыделяемое семя даёт null, соседи за невыделяемым не видны.
Selection.prototype._wordSpan = function (p) {
  var layout = this.renderer.layout;
  var L = layout[p.row];
  if (!L || !L.runs.length) return null;
  var run = Math.min(p.run, L.runs.length - 1);
  if (L.runs[run].run.unselectable) return null;
  var cells = this._runCells(p.row, run);
  if (!cells.length) return null;
  var ch = Math.min(p.ch, cells.length - 1);
  var cls = Selection._charClass(cells[ch]);
  var ar = run, ac = ch, br = run, bc = ch + 1;
  while (true) {
    if (ac > 0) {
      if (Selection._charClass(cells[ac - 1]) !== cls) break;
      ac--;
    } else if (ar > 0) {
      var pc = this._runCells(p.row, ar - 1);
      if (!pc.length) break;
      if (L.runs[ar - 1].run.unselectable) break;
      if (Selection._charClass(pc[pc.length - 1]) !== cls) break;
      ar--;
      cells = pc;
      ac = pc.length;
    } else break;
  }
  cells = this._runCells(p.row, br);
  while (true) {
    if (bc < cells.length) {
      if (Selection._charClass(cells[bc]) !== cls) break;
      bc++;
    } else if (br < L.runs.length - 1) {
      var nc = this._runCells(p.row, br + 1);
      if (!nc.length) break;
      if (L.runs[br + 1].run.unselectable) break;
      if (Selection._charClass(nc[0]) !== cls) break;
      br++;
      cells = nc;
      bc = 0;
    } else break;
  }
  return { a: { row: p.row, run: ar, ch: ac },
           b: { row: p.row, run: br, ch: bc } };
};

// Двойной клик: слово под позицией
Selection.prototype.selectWordAt = function (p) {
  var s = this._wordSpan(p);
  if (!s) return;
  this.anchor = s.a;
  this.focus = s.b;
  this.renderer.invalidate();
};

// Тройной клик: весь блок. В этом движке блок всегда одна строка раскладки.
// Строка без выделяемых отрезков не выбирается вообще:
// невидимому выделению нечего подавлять.
Selection.prototype.selectBlockAt = function (p) {
  var L = this.renderer.layout[p.row];
  if (!L || !L.runs.length) return;
  var any = false;
  for (var i = 0; i < L.runs.length; i++) {
    if (!L.runs[i].run.unselectable) { any = true; break; }
  }
  if (!any) return;
  this.anchor = { row: p.row, run: 0, ch: 0 };
  var last = L.runs.length - 1;
  this.focus = { row: p.row, run: last, ch: L.runs[last].run.cells.length };
  this.renderer.invalidate();
};

// ---- копирование ----

// Копировать выделение в буфер обмена
Selection.prototype.copy = function () {
  // Свежий снимок: копирование идёт в фазу ввода, до следующего кадра
  this._frame = this.current();
  var s = this._frame;
  if (!s) return false;
  var layout = this.renderer.layout;
  var lines = [];
  for (var r = s.a.row; r <= s.b.row; r++) {
    var L = layout[r];
    if (!L) continue;
    var parts = [];
    for (var j = 0; j < L.runs.length; j++) {
      var span = this.spanFor(r, j, L.runs[j].run.cells.length,
        L.runs[j].run.unselectable);
      if (span) parts.push(L.runs[j].run.cells.slice(span.a, span.b).join(""));
    }
    // Строка без выбранного текста (все отрезки невыделяемые) пропускается
    if (parts.length) lines.push(parts.join(""));
  }
  this._copyText(lines.join("\n"));
  return true;
};

// Буфер обмена: clipboard API, иначе textarea + execCommand
Selection.prototype._copyText = function (s) {
  if (!s) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    var p = navigator.clipboard.writeText(s);
    if (p && p.catch) p.catch(function () {});
  } else {
    var ta = document.createElement("textarea");
    ta.value = s;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(ta);
  }
};
