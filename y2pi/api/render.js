// ================= render.js =================
// Отрисовка: спрайты глифов, строки, выделение, сцена.
// Текст рисуется 1-битными спрайтами: альфа режется порогом ALPHA_CUT.
// Геометрия ячеек приходит из r_font (шаги и смещения чернил),
// measureText не используется. Перерисовка только по флагу dirty.

var links = [];
var visited = Object.create(null);
var VISITED_KEY = "pixel.visited";

// Посещённые ссылки живут в браузере: переживают перезагрузку.
// Любая неудача хранилища молча игнорируется.
function loadVisited() {
  try {
    if (typeof localStorage === "undefined") return;
    var list = JSON.parse(localStorage.getItem(VISITED_KEY) || "[]");
    for (var i = 0; i < list.length; i++) visited[list[i]] = true;
  } catch (e) {}
}

function rememberVisit(url) {
  visited[url] = true;
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(VISITED_KEY, JSON.stringify(Object.keys(visited)));
  } catch (e) {}
}

var mouseX = -1, mouseY = -1;
var hoverUrl = null, _cursor = null;
var dirty = true;

// Раскладка кадра: строки с геометрией отрезков
var layout = [];
// Выделение: концы { row, run, ch } в координатах документа
var selAnchor = null, selFocus = null, selecting = false;
var frameSel = null;

// Кэш спрайтов: "размер|цвет|символ" -> canvas
var glyphCache = {};

function labelFont(size) {
  return size + "px " + G.FONT + ", " + G.FONT_FALLBACK;
}

// Подчёркивание: на пиксель выше низа ячейки
function underlineY(dy, size) {
  return dy + size - G.UNDERLINE_H - 1;
}

// Линия с вырезами под чернилами: колонки, закрытые ореолом (cut),
// пропускаются. Короче диапазона на 1px справа (захардкожено,
// как у выделения слева). Видимые пиксели пакетируются в отрезки.
function segLine(x0, x1, uy, cut) {
  var rx = -1;
  for (var x = x0; x < x1 - 1; x++) {
    if (cut(x)) {
      if (rx >= 0) { ctx.fillRect(rx, uy, x - rx, G.UNDERLINE_H); rx = -1; }
    } else if (rx < 0) rx = x;
  }
  if (rx >= 0) ctx.fillRect(rx, uy, x1 - 1 - rx, G.UNDERLINE_H);
}

// ---- ореол глифов: вырез подчёркивания ----

// Форма глифа для выреза: строки битовых масок чернил.
// Цвет не участвует: форма одна на все краски.
var shapeCache = {};

function glyphShape(ch, size) {
  var key = size + "|" + ch;
  var s = shapeCache[key];
  if (!s) {
    if (ch === " ") s = { w: spriteW(size), rows: [] };
    else {
      var c = makeGlyph(ch, size, "#FFFFFF");
      var d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      var rows = [];
      for (var y = 0; y < c.height; y++) {
        var m = 0;
        for (var x = 0; x < c.width; x++) {
          if (d[(y * c.width + x) * 4 + 3] >= G.ALPHA_CUT) m |= (1 << x);
        }
        rows.push(m);
      }
      s = { w: c.width, rows: rows };
    }
    shapeCache[key] = s;
  }
  return s;
}

// Вырез отрезка: колонка x закрыта, если в окне 3x3 вокруг (x, uy)
// есть чернила. Невидимый ореол ровно 1px в каждую из 8 сторон:
// вырезает только подчёркивание, на остальное не влияет.
function lineCut(cells, offs, dx, dy, size, uy) {
  var gs = [];
  for (var i = 0; i < cells.length; i++) {
    gs.push({ s: glyphShape(cells[i], size),
      gx: dx + offs[i] + inkOff(cells[i], size) });
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
}

// Черта отрезка во всю ширину с вырезами под чернилами
function strokeRun(run, g, dx, dy, size, color) {
  ctx.fillStyle = color;
  var uy = underlineY(dy, size);
  segLine(dx, dx + g.w, uy, lineCut(run.cells, g.offs, dx, dy, size, uy));
}

function beginFrame() {
  links = [];
  layout = [];
  hoverUrl = null;
  frameSel = orderedSel();
  if (!ctx) return false;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = PAL.bg;
  ctx.fillRect(0, 0, viewW, viewH);
  return true;
}

function updateCursor() {
  if (!cv) return;
  if (hoverUrl !== _cursor) {
    _cursor = hoverUrl;
    cv.style.cursor = hoverUrl ? "pointer" : "default";
  }
}

function linkAt(x, y) {
  for (var i = 0; i < links.length; i++) {
    var L = links[i];
    if (x >= L.x && x < L.x + L.w && y >= L.y && y < L.y + L.h) return L.url;
  }
  return null;
}

function drawRule(y) {
  if (!ctx) return;
  ctx.fillStyle = PAL.rule;
  ctx.fillRect(G.SAFE_MARGIN, pix(y),
    Math.max(0, viewW - G.SAFE_MARGIN * 2), G.RULE_H);
}

// ---- спрайты глифов ----

function makeGlyph(ch, size, color) {
  var cw = spriteW(size);
  var c = document.createElement("canvas");
  c.width = cw;
  c.height = size;
  var g = c.getContext("2d");
  g.font = labelFont(size);
  g.textBaseline = "top";
  g.fillStyle = color;
  g.fillText(ch, 0, 0);
  var img = g.getImageData(0, 0, cw, size);
  var d = img.data;
  for (var i = 3; i < d.length; i += 4) {
    d[i] = (d[i] >= G.ALPHA_CUT) ? 255 : 0;
  }
  g.putImageData(img, 0, 0);
  return c;
}

function glyph(ch, size, color) {
  var key = size + "|" + color + "|" + ch;
  var s = glyphCache[key];
  if (!s) {
    s = makeGlyph(ch, size, color);
    glyphCache[key] = s;
  }
  return s;
}

// Ячейки строго по накопленным смещениям: целые координаты, масштаб 1:1.
// Чернила сдвигаются на отступ перед глифом, перо идёт своим шагом.
function blitText(cells, offs, dx, dy, size, color, a, b) {
  for (var i = a; i < b; i++) {
    if (cells[i] === " ") continue;
    ctx.drawImage(glyph(cells[i], size, color),
      dx + offs[i] + inkOff(cells[i], size), dy);
  }
}

// ---- выделение ----

function cmpEnd(p, q) {
  if (p.row !== q.row) return p.row - q.row;
  if (p.run !== q.run) return p.run - q.run;
  return p.ch - q.ch;
}

// Упорядоченная непустая пара концов или null
function orderedSel() {
  if (!selAnchor || !selFocus) return null;
  var a = selAnchor, b = selFocus;
  if (cmpEnd(a, b) > 0) { var t = a; a = b; b = t; }
  if (cmpEnd(a, b) === 0) return null;
  return { a: a, b: b };
}

// Выбранный диапазон ячеек отрезка или null.
// Невыделяемый отрезок не выбирается никогда.
// Флаг приходит параметром: во время отрисовки layout частично пуст,
// читать его отсюда нельзя.
function selSpan(row, run, len, unselectable) {
  var s = frameSel;
  if (!s) return null;
  if (unselectable) return null;
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
}

// Покрывает ли выбор ячейку ch соседнего отрезка.
// Читает только сцену и frameSel, не раскладку.
function runCovers(row, idx, run, ch) {
  if (!run) return false;
  var s = selSpan(row, idx, run.cells.length, run.unselectable);
  return !!s && ch >= s.a && ch < s.b;
}

// Подрезка пробелов на краях выбранного [a, b): пробел уже на 1px
// со стороны, где соседняя ячейка не подсвечена.
function spaceCuts(row, idx, run, prev, next, a, b) {
  var cuts = { l: 0, r: 0 };
  if (run.cells[a] === " ") {
    var pl = prev ? prev.cells.length - 1 : 0;
    if (a > 0 || !runCovers(row, idx - 1, prev, pl)) cuts.l = 1;
  }
  if (run.cells[b - 1] === " ") {
    if (b < run.cells.length || !runCovers(row, idx + 1, next, 0)) cuts.r = 1;
  }
  return cuts;
}

// Документная позиция под точкой (x, y в координатах контента)
function pickAt(x, y) {
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
  return { row: r, run: run, ch: charAtX(R.adv, x - R.x) };
}

function selectAll() {
  if (!layout.length) return;
  selAnchor = { row: 0, run: 0, ch: 0 };
  var last = layout.length - 1;
  var L = layout[last];
  if (!L.runs.length) {
    selFocus = { row: last, run: 0, ch: 0 };
  } else {
    var R = L.runs[L.runs.length - 1];
    selFocus = { row: last, run: L.runs.length - 1, ch: R.run.cells.length };
  }
  dirty = true;
}

// Класс символа для словесного выделения: 0 пробел, 1 слово, 2 прочее
function charClass(c) {
  if (c === " ") return 0;
  if (/[A-Za-z0-9_\u0400-\u04FF]/.test(c)) return 1;
  return 2;
}

function runCells(row, run) {
  return layout[row].runs[run].run.cells;
}

// Слово под позицией: расширяемся в классе символа через отрезки.
// Невыделяемое семя даёт null, соседи за невыделяемым не видны.
function wordSpan(p) {
  var L = layout[p.row];
  if (!L || !L.runs.length) return null;
  var run = Math.min(p.run, L.runs.length - 1);
  if (L.runs[run].run.unselectable) return null;
  var cells = runCells(p.row, run);
  if (!cells.length) return null;
  var ch = Math.min(p.ch, cells.length - 1);
  var cls = charClass(cells[ch]);
  var ar = run, ac = ch, br = run, bc = ch + 1;
  while (true) {
    if (ac > 0) {
      if (charClass(cells[ac - 1]) !== cls) break;
      ac--;
    } else if (ar > 0) {
      var pc = runCells(p.row, ar - 1);
      if (!pc.length) break;
      if (L.runs[ar - 1].run.unselectable) break;
      if (charClass(pc[pc.length - 1]) !== cls) break;
      ar--;
      cells = pc;
      ac = pc.length;
    } else break;
  }
  cells = runCells(p.row, br);
  while (true) {
    if (bc < cells.length) {
      if (charClass(cells[bc]) !== cls) break;
      bc++;
    } else if (br < L.runs.length - 1) {
      var nc = runCells(p.row, br + 1);
      if (!nc.length) break;
      if (L.runs[br + 1].run.unselectable) break;
      if (charClass(nc[0]) !== cls) break;
      br++;
      cells = nc;
      bc = 0;
    } else break;
  }
  return { a: { row: p.row, run: ar, ch: ac },
           b: { row: p.row, run: br, ch: bc } };
}

function selectWordAt(p) {
  var s = wordSpan(p);
  if (!s) return;
  selAnchor = s.a;
  selFocus = s.b;
  dirty = true;
}

// Весь блок: в этом движке блок всегда одна строка раскладки.
// Строка без выделяемых отрезков не выбирается вообще:
// невидимому выделению нечего подавлять.
function selectBlockAt(p) {
  var L = layout[p.row];
  if (!L || !L.runs.length) return;
  var any = false;
  for (var i = 0; i < L.runs.length; i++) {
    if (!L.runs[i].run.unselectable) { any = true; break; }
  }
  if (!any) return;
  selAnchor = { row: p.row, run: 0, ch: 0 };
  var last = L.runs.length - 1;
  selFocus = { row: p.row, run: last, ch: L.runs[last].run.cells.length };
  dirty = true;
}

function copyText(s) {
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
}

function copySelection() {
  frameSel = orderedSel();
  var s = frameSel;
  if (!s) return false;
  var lines = [];
  for (var r = s.a.row; r <= s.b.row; r++) {
    var L = layout[r];
    if (!L) continue;
    var parts = [];
    for (var j = 0; j < L.runs.length; j++) {
      var span = selSpan(r, j, L.runs[j].run.cells.length,
        L.runs[j].run.unselectable);
      if (span) parts.push(L.runs[j].run.cells.slice(span.a, span.b).join(""));
    }
    // Строка без выбранного текста (все отрезки невыделяемые) пропускается
    if (parts.length) lines.push(parts.join(""));
  }
  copyText(lines.join("\n"));
  return true;
}

// ---- строки ----

// Цвет отрезка: явный data-color бьёт всё; ссылки хранят свои цвета
// (тусклая, но кликабельная ссылка была бы ложью); дальше inactive,
// дальше роль строки.
// Токен "U<id>" раскрывается текущей темой, hex проходит как есть
function resolveU(c) {
  if (c.charAt(0) === "U") {
    var set = G.NEGATIVE ? U_DARK : U_LIGHT;
    return G.PALETTE[set[parseInt(c.slice(1), 10) - 16]];
  }
  return c;
}

function runColor(run, role) {
  if (run.color) return resolveU(run.color);
  if (run.url) return visited[run.url] ? PAL.visited : PAL.link;
  if (run.inactive) return PAL.inactive;
  return (role === "bright") ? PAL.bright : PAL.text;
}

// Строка из отрезков. Роль цвета: "text" или "bright".
// Геометрию пишем в layout[rowIdx] для выделения и хит-тестов.
function drawRuns(runs, x, y, size, center, role, rowIdx) {
  if (!ctx) return;
  var dy = pix(y);
  if (!runs.length) {
    layout[rowIdx] = { y: dy + scrollY, h: size, runs: [] };
    return;
  }
  var gs = [], total = 0, i;
  for (i = 0; i < runs.length; i++) {
    var adv = runAdvances(runs[i].cells, size);
    var offs = cumOffsets(adv);
    gs.push({ adv: adv, offs: offs, w: offs[offs.length - 1] });
    total += offs[offs.length - 1];
  }
  // Центрирование всегда в пол: нечётная ширина — приоритет левой стороне
  var dx = center ? Math.floor((viewW - total) / 2) : pix(x);
  var geo = [];
  for (i = 0; i < runs.length; i++) {
    geo.push({ run: runs[i], x: dx, w: gs[i].w, adv: gs[i].adv });
    if (runs[i].url) drawRunLink(runs[i], gs[i], dx, dy, size, rowIdx, i,
      runs[i - 1] || null, runs[i + 1] || null);
    else drawRunText(runs[i], gs[i], dx, dy, size, role, rowIdx, i,
      runs[i - 1] || null, runs[i + 1] || null);
    if (DEBUG.halo) drawHalo(runs[i].cells, gs[i].offs, dx, dy, size);
    dx += gs[i].w;
  }
  layout[rowIdx] = { y: dy + scrollY, h: size, runs: geo };
}

// Отрезок с выделением [a, b): подложка + три куска текста.
// Подчёркивание идёт по сегментам в цвет текста под ним.
function drawSelectedText(cells, offs, dx, dy, size, color, a, b, underlined,
    cuts) {
  // Выделение шире диапазона на 1px влево (захардкожено),
  // краевые пробелы подрезаются со стороны неподсвеченного соседа
  var x0 = dx + offs[a] - 1 + cuts.l, x1 = dx + offs[b] - cuts.r;
  ctx.fillStyle = PAL.bright;
  ctx.fillRect(x0, dy, Math.max(0, x1 - x0), size);
  blitText(cells, offs, dx, dy, size, color, 0, a);
  blitText(cells, offs, dx, dy, size, PAL.bg, a, b);
  blitText(cells, offs, dx, dy, size, color, b, cells.length);
  if (underlined) {
    // Черта не следует за левым пикселем подложки: остаётся на месте
    var uy = underlineY(dy, size);
    var cut = lineCut(cells, offs, dx, dy, size, uy);
    ctx.fillStyle = color;
    segLine(dx + offs[0], dx + offs[a], uy, cut);
    segLine(dx + offs[b], dx + offs[cells.length], uy, cut);
    ctx.fillStyle = PAL.bg;
    segLine(dx + offs[a], dx + offs[b], uy, cut);
  }
}

function drawRunText(run, g, dx, dy, size, role, rowIdx, runIdx, prev, next) {
  var color = runColor(run, role);
  var span = selSpan(rowIdx, runIdx, run.cells.length, run.unselectable);
  if (span) {
    drawSelectedText(run.cells, g.offs, dx, dy, size, color, span.a, span.b,
      run.underlined,
      spaceCuts(rowIdx, runIdx, run, prev, next, span.a, span.b));
  } else {
    blitText(run.cells, g.offs, dx, dy, size, color, 0, run.cells.length);
    if (run.underlined) strokeRun(run, g, dx, dy, size, color);
  }
}

// Ссылка, свой рендеринг: цвет, по наведению инверсия
// (подавляется активным выделением), посещённая другим цветом.
// Подчёркивание только по флагу и всегда в цвет текста под ним.
function drawRunLink(run, g, dx, dy, size, rowIdx, runIdx, prev, next) {
  var color = runColor(run); // роль не нужна: ссылка уходит цветом по url раньше неё
  var hover = !frameSel && (mouseX >= dx && mouseX < dx + g.w &&
               mouseY >= dy && mouseY < dy + size);
  var span = selSpan(rowIdx, runIdx, run.cells.length, run.unselectable);
  if (hover) {
    // Подложка шире на 1px влево, как у выделения; черта остаётся на месте
    if (g.w > 0) {
      ctx.fillStyle = color;
      ctx.fillRect(dx - 1, dy, g.w + 1, size);
    }
    blitText(run.cells, g.offs, dx, dy, size, PAL.bg, 0, run.cells.length);
    if (run.underlined) strokeRun(run, g, dx, dy, size, PAL.bg);
    hoverUrl = run.url;
  } else if (span) {
    drawSelectedText(run.cells, g.offs, dx, dy, size, color, span.a, span.b,
      run.underlined,
      spaceCuts(rowIdx, runIdx, run, prev, next, span.a, span.b));
  } else {
    blitText(run.cells, g.offs, dx, dy, size, color, 0, run.cells.length);
    if (run.underlined) strokeRun(run, g, dx, dy, size, color);
  }
  links.push({ x: dx, y: dy + scrollY, w: g.w, h: size, url: run.url });
}

function renderScene() {
  if (!dirty) return;
  if (!beginFrame()) return;
  dirty = false;
  var M = G.SAFE_MARGIN;
  var y = M - scrollY;
  var row = 0;
  for (var i = 0; i < blocks.length; i++) {
    var b = blocks[i];
    if (b.type === "rule") {
      drawRule(y);
      y += G.RULE_H + G.BLOCK_GAP;
    } else if (b.type === "list") {
      for (var j = 0; j < b.items.length; j++) {
        var it = b.items[j];
        drawRuns(it.runs, M, y, G.CELL_H, it.center, "text", row);
        row++;
        y += G.CELL_H + G.ITEM_GAP;
      }
      y += Math.max(0, G.BLOCK_GAP - G.ITEM_GAP);
    } else {
      drawRuns(b.runs, M, y, b.size, b.center, b.role, row);
      row++;
      y += b.size + G.BLOCK_GAP;
    }
  }
  contentH = y + scrollY;
  clampScroll();
  drawDebugBadge();
  updateCursor();
}
