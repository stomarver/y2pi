// ================= input.js =================
// Ввод: указатель (наведение, выделение, клики) и клавиши.
// Дискретное (клики, клавиши) уходит намерениями в очередь тиков:
// обрабатывается в фазу ввода, быстрее тиков — никогда.
// Непрерывное (позиция указателя) — сэмплируемый регистр:
// кадр всегда читает свежее, очередь ему не нужна.

var downX = 0, downY = 0;
// Счётчик кликов: время, точка и число нажатий подряд
var clickT = 0, clickX = 0, clickY = 0, clickN = 0;

function bindPointer() {
  if (!cv) return;
  cv.onmousedown = function (e) {
    // Без preventDefault: иначе клик не даёт фокус и клавиши умирают.
    // У canvas нет нативного драга и выделяемого текста, глушить нечего.
    var cx = e.clientX, cy = e.clientY, now = Date.now();
    pushInput(function () {
      // Нажатие в серии мультиклика выделение не схлопывает:
      // иначе между словом и блоком мелькал бы пустой кадр.
      var series = (clickN === 1 || clickN === 2) &&
                   (now - clickT <= G.MULTI_CLICK_MS) &&
                   Math.abs(cx - clickX) <= 4 &&
                   Math.abs(cy - clickY) <= 4;
      downX = cx; downY = cy;
      var p = pickAt(pix(cx / scaleFactor),
                     pix(cy / scaleFactor) + scrollY);
      if (p) {
        if (!series) { selAnchor = p; selFocus = p; }
        selecting = true;
      }
      dirty = true;
    });
  };
  cv.onmousemove = function (e) {
    var nx = pix(e.clientX / scaleFactor);
    var ny = pix(e.clientY / scaleFactor);
    if (nx === mouseX && ny === mouseY) return;
    mouseX = nx; mouseY = ny;
    if (selecting) {
      var p = pickAt(mouseX, mouseY + scrollY);
      if (p) selFocus = p;
    }
    dirty = true;
  };
  cv.onmouseleave = function () {
    mouseX = -1; mouseY = -1;
    dirty = true;
  };
  cv.onclick = function (e) {
    var cx = e.clientX, cy = e.clientY, now = Date.now();
    pushInput(function () {
      // Таскание = выделение, а не клик
      if (Math.abs(cx - downX) > 2 ||
          Math.abs(cy - downY) > 2) { clickN = 0; return; }
      var near = Math.abs(cx - clickX) <= 4 &&
                 Math.abs(cy - clickY) <= 4;
      if (now - clickT <= G.MULTI_CLICK_MS && near) clickN++;
      else clickN = 1;
      clickT = now; clickX = cx; clickY = cy;
      var lx = pix(cx / scaleFactor);
      var ly = pix(cy / scaleFactor) + scrollY;
      // Двойной клик — слово, тройной — весь блок
      if (clickN === 2) {
        var w = pickAt(lx, ly);
        if (w) selectWordAt(w);
        return;
      }
      if (clickN === 3) {
        var bl = pickAt(lx, ly);
        if (bl) selectBlockAt(bl);
        clickN = 0;
        return;
      }
      var u = linkAt(lx, ly);
      if (u) {
        rememberVisit(u);
        dirty = true;
        window.location.href = u;
      }
    });
  };
  window.onmouseup = function () { pushInput(function () { selecting = false; }); };
}

function bindKeys() {
  window.onkeydown = function (e) {
    // Повторы зажатой клавиши не команды: иначе удержание
    // обрабатывалось бы чаще графики
    if (e && e.repeat) return;
    var code = (e && e.code) || "";
    var key = (e && e.key) || "";
    var mod = e && (e.ctrlKey || e.metaKey);
    // Код клавиши + запасной вариант по символу (и русская раскладка)
    var copy = (code === "KeyC" || key === "c" || key === "C" ||
                key === "с" || key === "С");
    var all = (code === "KeyA" || key === "a" || key === "A" ||
               key === "ф" || key === "Ф");
    var one = (code === "Digit1" || key === "1");
    var dbg = (code === "Digit0" || key === "0");
    var halo = (code === "Digit7" || key === "7");
    if (mod && copy) {
      if (orderedSel()) e.preventDefault();
      pushInput(copySelection);
      return;
    }
    if (mod && all) {
      pushInput(selectAll);
      e.preventDefault();
      return;
    }
    // Ctrl+0 глушим: иначе браузер сбросит масштаб страницы
    if (mod && dbg) {
      pushInput(toggleDebug);
      e.preventDefault();
      return;
    }
    if (!mod && one) pushInput(function () { if (DEBUG.on) setNegative(!G.NEGATIVE); });
    if (!mod && halo) pushInput(toggleHalo);
  };
}
