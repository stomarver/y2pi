// ================= start.js =================
// Точка входа: шрифт, сборка сцены, canvas, цикл. Грузится последним.

function boot() {
  if (!document.body) return;
  loadFont();
  collectBlocks();
  applyNegative();
  loadVisited();
  if (!createCanvas()) return;
  bindPointer();
  bindKeys();
  addTick(renderScene);
  startTicks();
  // Прячем исходник последним: любой сбой выше оставит видимый html
  hideSource();
  renderScene();
}

boot();
