// ================= ticks.js =================
// Единая тиковая система. Старт/стоп идемпотентны.
// Каждый тик: сначала фаза ввода (очередь намерений),
// потом обработчики (графика). Ввод быстрее тиков не обрабатывается.

// Период тика, мс: от G.TICK_HZ
var TICK_MS = 1000 / G.TICK_HZ;

/**
 * Тиковый планировщик: очередь намерений ввода + обработчики кадра.
 *
 * @constructor
 */
function Scheduler() {
  /** @type {number} */
  this.count = 0;
  /** @type {function(number):void[]} */
  this._handlers = [];
  /** @type {?number} */
  this._timer = null;
  /** @type {function():void[]} */
  this._inputQ = [];
}

Scheduler.prototype.addTick = function (fn) {
  this._handlers.push(fn);
};

// Намерение ввода: выполнится в фазу ввода ближайшего тика.
// Порядок очереди = порядок событий.
Scheduler.prototype.pushInput = function (fn) {
  this._inputQ.push(fn);
};

// Фаза ввода: выполняет очередь и очищает её.
// Тесты дёргают напрямую: детерминированно, без таймеров.
Scheduler.prototype.pumpInput = function () {
  var q = this._inputQ;
  this._inputQ = [];
  for (var i = 0; i < q.length; i++) q[i]();
};

Scheduler.prototype.start = function () {
  if (this._timer !== null) return;
  var self = this;
  this._timer = setInterval(function () {
    self.count++;
    self.pumpInput();
    for (var i = 0; i < self._handlers.length; i++) {
      self._handlers[i](self.count);
    }
  }, TICK_MS);
};

Scheduler.prototype.stop = function () {
  if (this._timer === null) return;
  clearInterval(this._timer);
  this._timer = null;
};
