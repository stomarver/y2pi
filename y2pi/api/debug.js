// ================= debug.js =================
// Отладка: режим по Ctrl+0, в нём клавиша 7 показывает ореолы глифов.
// Ореол рисуется тем же окном 3x3, что вырезает подчёркивание.

var DEBUG = { on: false, halo: false };

function toggleDebug() {
  DEBUG.on = !DEBUG.on;
  if (!DEBUG.on) DEBUG.halo = false;
  dirty = true;
}

function toggleHalo() {
  if (!DEBUG.on) return;
  DEBUG.halo = !DEBUG.halo;
  dirty = true;
}

// Видимый ореол: кольцо вокруг чернил в цвет magenta наоборот теме.
// Сами чернила не закрашиваются, текст остаётся читаемым.
function drawHalo(cells, offs, dx, dy, size) {
  ctx.fillStyle = G.NEGATIVE ? G.PALETTE[5] : G.PALETTE[13]; // наоборот теме: тёмная на тёмной
  for (var i = 0; i < cells.length; i++) {
    if (cells[i] === " ") continue;
    var s = glyphShape(cells[i], size);
    var gx = dx + offs[i] + inkOff(cells[i], size);
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
}

// Бейдж режима: слово debug в самом правом нижнем углу кадрового буфера
// (не страницы: от скролла не зависит; без отступов). Подложка по правилам
// выделения, в раскладку не попадает — выделить и скопировать нельзя.
function drawDebugBadge() {
  if (!DEBUG.on || !ctx) return;
  var cells = toCells("debug");
  var adv = runAdvances(cells, G.CELL_H);
  var offs = cumOffsets(adv);
  var w = offs[offs.length - 1];
  var dx = viewW - w;
  var dy = viewH - G.CELL_H;
  ctx.fillStyle = PAL.bright;
  ctx.fillRect(dx - 1, dy, w + 1, G.CELL_H);
  blitText(cells, offs, dx, dy, G.CELL_H, PAL.bg, 0, cells.length);
}
