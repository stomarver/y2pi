// ================= ticks.js =================
// Единая тиковая система. Старт/стоп идемпотентны.
// Каждый тик: сначала фаза ввода (очередь намерений),
// потом обработчики (графика). Ввод быстрее тиков не обрабатывается.

var tickCount = 0;
var _tickHandlers = [];
var _tickTimer = null;
var inputQ = [];

function addTick(fn) {
  _tickHandlers.push(fn);
}

// Намерение ввода: выполнится в фазу ввода ближайшего тика.
// Порядок очереди = порядок событий.
function pushInput(fn) {
  inputQ.push(fn);
}

// Фаза ввода: выполняет очередь и очищает её.
// Тесты дёргают напрямую: детерминированно, без таймеров.
function pumpInput() {
  var q = inputQ;
  inputQ = [];
  for (var i = 0; i < q.length; i++) q[i]();
}

function startTicks() {
  if (_tickTimer !== null) return;
  _tickTimer = setInterval(function () {
    tickCount++;
    pumpInput();
    for (var i = 0; i < _tickHandlers.length; i++) {
      _tickHandlers[i](tickCount);
    }
  }, TICK_MS);
}

function stopTicks() {
  if (_tickTimer === null) return;
  clearInterval(_tickTimer);
  _tickTimer = null;
}
