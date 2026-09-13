// ================= start.js =================
// Точка входа: композиция компонентов, сборка сцены, цикл.
// Живёт в корне api/ (рядом с boot.js) и грузится последним.
//
//   Engine
//    ├─ tick      Scheduler   тики + очередь намерений ввода
//    ├─ view      Viewport    canvas, масштаб, скролл
//    ├─ rfont     RFONT       шрифтовой движок: .kern, метрики,
//                             спрайты глифов, рендеринг ячеек
//    ├─ palette   Palette     цвета, темы (чистая логика без DOM)
//    ├─ scene     Scene       блоки из DOM
//    ├─ renderer  Renderer    раскладка, выделение, кадр
//    ├─ selection Selection   выделение и копирование
//    ├─ input     Input       указатель и клавиши
//    ├─ debug     Debug       debug-режим и ореолы (состояние)
//    └─ pointer   {x, y}      регистр указателя: пишем Input,
//                             читает Renderer (наведение)
//
// Хуки невалидации (view.invalidate, rfont.onChange, debug.onChange)
// Engine подключает после создания: компоненты не знают о Renderer.

/**
 * Движок: композиция всех компонентов, коннект хуков, цикл.
 *
 * @constructor
 */
function Engine() {
  /** @type {Scheduler} */
  this.tick = null;
  /** @type {Viewport} */
  this.view = null;
  /** @type {RFONT} */
  this.rfont = null;
  /** @type {Palette} */
  this.palette = null;
  /** @type {Scene} */
  this.scene = null;
  /** @type {Renderer} */
  this.renderer = null;
  /** @type {Selection} */
  this.selection = null;
  /** @type {Input} */
  this.input = null;
  /** @type {Debug} */
  this.debug = null;
  /** @type {{x: number, y: number}} */
  this.pointer = { x: -1, y: -1 };
}

Engine.prototype.boot = function () {
  if (!document.body) return;
  var self = this;

  this.palette = new Palette();
  this.tick = new Scheduler();
  this.view = new Viewport(this.tick, function () { self._renderNow(); });
  this.rfont = new RFONT(this.view);
  this.debug = new Debug();
  this.scene = new Scene();
  this.renderer = new Renderer(this.rfont, this.palette, this.view,
                               this.scene, this.debug, this.pointer);
  this.selection = new Selection(this.renderer, this.rfont);
  this.renderer.selection = this.selection;
  this.input = new Input(this.view, this.tick, this.renderer,
                         this.selection, this.debug, this.pointer,
                         function () { self.toggleTheme(); });

  // Невалидация: кто тронул мир — тот просит перерисовку
  this.view.invalidate = function () { self.renderer.invalidate(); };
  this.rfont.onChange = function () {
    self.rfont.clearCaches();
    self.renderer.invalidate();
  };
  this.debug.onChange = function () { self.renderer.invalidate(); };

  this.rfont.load();
  this.scene.collect();
  this.palette.setNegative(G.NEGATIVE);
  this._applyTheme();
  this.renderer.loadVisited();
  if (!this.view.create()) return;
  this._applyTheme();
  this.input.bind();
  this.tick.addTick(function () { self.renderer.frame(); });
  this.tick.start();
  // Прячем исходник последним: любой сбой выше оставит видимый html
  this.scene.hide();
  this.renderer.frame();
};

// Перерисовать синхронно в том же таске: пустой кадр не показывается
Engine.prototype._renderNow = function () {
  this.renderer.invalidate();
  this.renderer.frame();
};

// Фон страницы и canvas под текущую палитру
Engine.prototype._applyTheme = function () {
  document.body.style.background = this.palette.current.bg;
  if (this.view.cv) this.view.cv.style.background = this.palette.current.bg;
};

// Клавиша 1 в debug-режиме
Engine.prototype.toggleTheme = function () {
  this.palette.setNegative(!G.NEGATIVE);
  this._applyTheme();
  this.renderer.invalidate();
};

var engine = new Engine();
engine.boot();
