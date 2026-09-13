// ================= canvas.js =================
// Канвас и вьюпорт: виртуальное разрешение, целочисленный масштаб,
// выравнивание, создание canvas, прокрутка.
// contentH пишет Renderer раз в кадр; invalidate — хук Engine.

/**
 * Вьюпорт: canvas, целочисленный масштаб, прокрутка.
 *
 * @constructor
 * @param {Scheduler} tick
 * @param {function():void} onRecomputed  Геометрия изменилась:
 *   перерисовать синхронно в том же таске (пустой кадр не показывается)
 */
function Viewport(tick, onRecomputed) {
  /** @type {Scheduler} */
  this.tick = tick;
  /** @type {function():void} */
  this.onRecomputed = onRecomputed;
  /** @type {?function():void} */
  this.invalidate = null;  // Engine: попросить перерисовку
  /** @type {HTMLCanvasElement|null} */
  this.cv = null;
  /** @type {CanvasRenderingContext2D|null} */
  this.ctx = null;
  /** @type {number} */
  this.viewW = 0;
  /** @type {number} */
  this.viewH = 0;
  /** @type {number} */
  this.scale = 1;
  /** @type {number} */
  this._prevScale = 0;
  /** @type {number} */
  this.scrollY = 0;
  /** @type {number} */
  this.contentH = 0;  // Renderer пишет раз в кадр
}

// ---- масштаб ----

// Сырой шаг по таблице без гистерезиса
Viewport.prototype._rawStep = function (w) {
  var s = G.SCALE_STEPS[0];
  for (var i = 0; i < G.SCALE_STEPS.length; i++) {
    if (w >= G.SCALE_WIDTHS[i]) s = G.SCALE_STEPS[i];
  }
  return s;
};

// Граница ширины, на которой начинается шаг
Viewport.prototype._stepBoundary = function (step) {
  for (var i = 0; i < G.SCALE_STEPS.length; i++) {
    if (G.SCALE_STEPS[i] === step) return G.SCALE_WIDTHS[i];
  }
  return 0;
};

// Шаг с гистерезисом: у границы в пределах SCALE_GAP не переключаемся
Viewport.prototype._computeScale = function (w) {
  var s = this._rawStep(w);
  if (this._prevScale > 0 && s !== this._prevScale) {
    var b = (s > this._prevScale) ? this._stepBoundary(s)
                                  : this._stepBoundary(this._prevScale);
    if (Math.abs(w - b) <= G.SCALE_GAP) s = this._prevScale;
  }
  if (s < 1) s = 1;
  this._prevScale = s;
  return s;
};

// Выравнивание по углу, режим из PIX_MODE
Viewport.prototype.pix = function (v) {
  if (G.PIX_MODE === "round") return Math.round(v);
  if (G.PIX_MODE === "ceil") return Math.ceil(v);
  return Math.floor(v);
};

// ---- канвас ----

Viewport.prototype.create = function () {
  document.body.style.margin = "0";
  document.body.style.padding = "0";
  document.body.style.overflow = "hidden";
  var cv = document.createElement("canvas");
  cv.id = "scr";
  cv.style.display = "block";
  cv.style.imageRendering = "crisp-edges";
  cv.style.imageRendering = "pixelated";
  document.body.appendChild(cv);
  this.cv = cv;
  this.ctx = cv.getContext("2d", { alpha: false });
  if (!this.ctx) return null;
  var self = this;
  window.onresize = function () { self.recompute(); };
  this._bindWheel();
  this.recompute();
  return this.ctx;
};

Viewport.prototype.recompute = function () {
  if (!this.cv) return;
  var w = window.innerWidth, h = window.innerHeight;
  var ns = this._computeScale(w);
  var nw = this.pix(w / ns), nh = this.pix(h / ns);
  if (nw < G.MIN_VIEW) nw = G.MIN_VIEW;
  if (nh < G.MIN_VIEW) nh = G.MIN_VIEW;
  // Геометрия не изменилась: сбрасывать canvas незачем
  if (ns === this.scale && nw === this.viewW && nh === this.viewH) return;
  this.scale = ns;
  this.viewW = nw;
  this.viewH = nh;
  this.cv.width = this.viewW;
  this.cv.height = this.viewH;
  // CSS-размер кратен бэкстору: апскейл всегда целочисленный.
  // Недобор справа/снизу теряется на фоне страницы.
  this.cv.style.width = (this.viewW * this.scale) + "px";
  this.cv.style.height = (this.viewH * this.scale) + "px";
  this.clamp();
  // Синхронно в том же таске: пустой кадр никогда не показывается
  if (this.onRecomputed) this.onRecomputed();
};

// ---- скролл ----

// Кастомный скролл: пропорционален дельте колеса и силе G.WHEEL.
// Дробная часть копится в scrollY, на экран ложится через pix.
Viewport.prototype._bindWheel = function () {
  var self = this;
  window.onwheel = function (e) {
    var d = e.deltaY, m = e.deltaMode;
    self.tick.pushInput(function () {
      var dd = d;
      if (m === 1) dd *= G.SCROLL_STEP;
      else if (m === 2) dd *= self.viewH;
      self.scrollY += dd * G.WHEEL;
      self.clamp();
      if (self.invalidate) self.invalidate();
    });
  };
};

Viewport.prototype.clamp = function () {
  var max = this.contentH - this.viewH;
  if (max < 0) max = 0;
  if (this.scrollY < 0) this.scrollY = 0;
  if (this.scrollY > max) this.scrollY = max;
};
