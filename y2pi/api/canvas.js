// ================= canvas.js =================
// Канвас и вьюпорт: виртуальное разрешение, целочисленный масштаб,
// выравнивание, создание canvas, прокрутка.

// Логические ширина/высота = вьюпорт / масштаб
var viewW = 0, viewH = 0;
var scaleFactor = 1;
var _prevScale = 0;

// Смещение вида (прокрутка) и полная высота контента сцены
var scrollY = 0, contentH = 0;

var cv = null, ctx = null;

// Сырой шаг по таблице без гистерезиса
function rawStep(w) {
  var s = G.SCALE_STEPS[0];
  for (var i = 0; i < G.SCALE_STEPS.length; i++) {
    if (w >= G.SCALE_WIDTHS[i]) s = G.SCALE_STEPS[i];
  }
  return s;
}

// Граница ширины, на которой начинается шаг
function stepBoundary(step) {
  for (var i = 0; i < G.SCALE_STEPS.length; i++) {
    if (G.SCALE_STEPS[i] === step) return G.SCALE_WIDTHS[i];
  }
  return 0;
}

// Шаг с гистерезисом: у границы в пределах SCALE_GAP не переключаемся
function computeScale(w) {
  var s = rawStep(w);
  if (_prevScale > 0 && s !== _prevScale) {
    var b = (s > _prevScale) ? stepBoundary(s) : stepBoundary(_prevScale);
    if (Math.abs(w - b) <= G.SCALE_GAP) s = _prevScale;
  }
  if (s < 1) s = 1;
  _prevScale = s;
  return s;
}

// Выравнивание по углу, режим из PIX_MODE
function pix(v) {
  if (G.PIX_MODE === "round") return Math.round(v);
  if (G.PIX_MODE === "ceil") return Math.ceil(v);
  return Math.floor(v);
}

function createCanvas() {
  document.body.style.margin = "0";
  document.body.style.padding = "0";
  document.body.style.overflow = "hidden";
  cv = document.createElement("canvas");
  cv.id = "scr";
  cv.style.display = "block";
  cv.style.imageRendering = "crisp-edges";
  cv.style.imageRendering = "pixelated";
  document.body.appendChild(cv);
  ctx = cv.getContext("2d", { alpha: false });
  if (!ctx) return null;
  window.onresize = recomputeViewport;
  bindWheel();
  recomputeViewport();
  return ctx;
}

function recomputeViewport() {
  if (!cv) return;
  var w = window.innerWidth, h = window.innerHeight;
  var ns = computeScale(w);
  var nw = pix(w / ns), nh = pix(h / ns);
  if (nw < G.MIN_VIEW) nw = G.MIN_VIEW;
  if (nh < G.MIN_VIEW) nh = G.MIN_VIEW;
  // Геометрия не изменилась: сбрасывать canvas незачем
  if (ns === scaleFactor && nw === viewW && nh === viewH) return;
  scaleFactor = ns;
  viewW = nw;
  viewH = nh;
  cv.width = viewW;
  cv.height = viewH;
  // CSS-размер кратен бэкстору: апскейл всегда целочисленный.
  // Недобор справа/снизу теряется на фоне страницы.
  cv.style.width = (viewW * scaleFactor) + "px";
  cv.style.height = (viewH * scaleFactor) + "px";
  clampScroll();
  dirty = true;
  // Синхронно в том же таске: пустой кадр никогда не показывается
  renderScene();
}

// Кастомный скролл: пропорционален дельте колеса и силе G.WHEEL.
// Дробная часть копится в scrollY, на экран ложится через pix.
function bindWheel() {
  window.onwheel = function (e) {
    var d = e.deltaY, m = e.deltaMode;
    pushInput(function () {
      var dd = d;
      if (m === 1) dd *= G.SCROLL_STEP;
      else if (m === 2) dd *= viewH;
      scrollY += dd * G.WHEEL;
      clampScroll();
      dirty = true;
    });
  };
}

function clampScroll() {
  var max = contentH - viewH;
  if (max < 0) max = 0;
  if (scrollY < 0) scrollY = 0;
  if (scrollY > max) scrollY = max;
}
