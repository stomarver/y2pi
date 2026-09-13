// ================= input.js =================
// Ввод: указатель (наведение, выделение, клики) и клавиши.
// Дискретное (клики, клавиши) уходит намерениями в очередь тиков:
// обрабатывается в фазу ввода, быстрее тиков — никогда.
// Непрерывное (позиция указателя) — сэмплируемый регистр pointer:
// кадр всегда читает свежее, очередь ему не нужна.

/**
 * Ввод: указатель (наведение, выделение, клики) и клавиши.
 *
 * @constructor
 * @param {Viewport} view
 * @param {Scheduler} tick
 * @param {Renderer} renderer
 * @param {Selection} selection
 * @param {Debug} debug
 * @param {{x: number, y: number}} pointer
 * @param {function():void} onToggleTheme  клавиша 1 в debug-режиме
 */
function Input(view, tick, renderer, selection, debug, pointer, onToggleTheme) {
  /** @type {Viewport} */
  this.view = view;
  /** @type {Scheduler} */
  this.tick = tick;
  /** @type {Renderer} */
  this.renderer = renderer;
  /** @type {Selection} */
  this.selection = selection;
  /** @type {Debug} */
  this.debug = debug;
  /** @type {{x: number, y: number}} */
  this.pointer = pointer;
  /** @type {function():void} */
  this.onToggleTheme = onToggleTheme;
  /** @type {number} */
  this._downX = 0;
  /** @type {number} */
  this._downY = 0;
  // Счётчик кликов: время, точка и число нажатий подряд
  /** @type {number} */
  this._clickT = 0;
  /** @type {number} */
  this._clickX = 0;
  /** @type {number} */
  this._clickY = 0;
  /** @type {number} */
  this._clickN = 0;
}

// ---- указатель ----

Input.prototype.bind = function () {
  var self = this;
  var cv = this.view.cv;
  if (cv) {
    cv.onmousedown = function (e) {
      // Без preventDefault: иначе клик не даёт фокус и клавиши умирают.
      // У canvas нет нативного драга и выделяемого текста, глушить нечего.
      var cx = e.clientX, cy = e.clientY, now = Date.now();
      self.tick.pushInput(function () {
        // Нажатие в серии мультиклика выделение не схлопывает:
        // иначе между словом и блоком мелькал бы пустой кадр.
        var series = (self._clickN === 1 || self._clickN === 2) &&
                     (now - self._clickT <= G.MULTI_CLICK_MS) &&
                     Math.abs(cx - self._clickX) <= 4 &&
                     Math.abs(cy - self._clickY) <= 4;
        self._downX = cx; self._downY = cy;
        var p = self.selection.pickAt(
          self.view.pix(cx / self.view.scale),
          self.view.pix(cy / self.view.scale) + self.view.scrollY);
        if (p) {
          if (!series) self.selection.reset(p);
          self.selection.selecting = true;
        }
        self.renderer.invalidate();
      });
    };
    cv.onmousemove = function (e) {
      var nx = self.view.pix(e.clientX / self.view.scale);
      var ny = self.view.pix(e.clientY / self.view.scale);
      if (nx === self.pointer.x && ny === self.pointer.y) return;
      self.pointer.x = nx; self.pointer.y = ny;
      if (self.selection.selecting) {
        var p = self.selection.pickAt(self.pointer.x,
                                      self.pointer.y + self.view.scrollY);
        if (p) self.selection.focus = p;
      }
      self.renderer.invalidate();
    };
    cv.onmouseleave = function () {
      self.pointer.x = -1; self.pointer.y = -1;
      self.renderer.invalidate();
    };
    cv.onclick = function (e) {
      var cx = e.clientX, cy = e.clientY, now = Date.now();
      self.tick.pushInput(function () {
        // Таскание = выделение, а не клик
        if (Math.abs(cx - self._downX) > 2 ||
            Math.abs(cy - self._downY) > 2) { self._clickN = 0; return; }
        var near = Math.abs(cx - self._clickX) <= 4 &&
                   Math.abs(cy - self._clickY) <= 4;
        if (now - self._clickT <= G.MULTI_CLICK_MS && near) self._clickN++;
        else self._clickN = 1;
        self._clickT = now; self._clickX = cx; self._clickY = cy;
        var lx = self.view.pix(cx / self.view.scale);
        var ly = self.view.pix(cy / self.view.scale) + self.view.scrollY;
        // Двойной клик — слово, тройной — весь блок
        if (self._clickN === 2) {
          var w = self.selection.pickAt(lx, ly);
          if (w) self.selection.selectWordAt(w);
          return;
        }
        if (self._clickN === 3) {
          var bl = self.selection.pickAt(lx, ly);
          if (bl) self.selection.selectBlockAt(bl);
          self._clickN = 0;
          return;
        }
        var u = self.renderer.linkAt(lx, ly);
        if (u) {
          self.renderer.rememberVisit(u);
          self.renderer.invalidate();
          window.location.href = u;
        }
      });
    };
  }
  window.onmouseup = function () {
    self.tick.pushInput(function () { self.selection.selecting = false; });
  };
  self._bindKeys();
};

// ---- клавиши ----

Input.prototype._bindKeys = function () {
  var self = this;
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
      if (self.selection.current()) e.preventDefault();
      self.tick.pushInput(function () { self.selection.copy(); });
      return;
    }
    if (mod && all) {
      self.tick.pushInput(function () { self.selection.selectAll(); });
      e.preventDefault();
      return;
    }
    // Ctrl+0 глушим: иначе браузер сбросит масштаб страницы
    if (mod && dbg) {
      self.tick.pushInput(function () { self.debug.toggle(); });
      e.preventDefault();
      return;
    }
    if (!mod && one) self.tick.pushInput(function () {
      if (self.debug.on) self.onToggleTheme();
    });
    if (!mod && halo) self.tick.pushInput(function () { self.debug.toggleHalo(); });
  };
};
