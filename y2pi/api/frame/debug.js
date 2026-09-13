// ================= debug.js =================
// Debug-режим по Ctrl+0, в нём клавиша 7 показывает ореолы глифов.

/**
 * Debug-режим (Ctrl+0) и ореолы глифов (клавиша 7):
 * только состояние и переключатели, отрисовка — в Renderer.
 *
 * @constructor
 */
function Debug() {
  /** @type {boolean} */
  this.on = false;
  /** @type {boolean} */
  this.halo = false;
  /** @type {?function():void} */
  this.onChange = null;  // Engine: невалидация
}

Debug.prototype.toggle = function () {
  this.on = !this.on;
  if (!this.on) this.halo = false;
  if (this.onChange) this.onChange();
};

Debug.prototype.toggleHalo = function () {
  if (!this.on) return;
  this.halo = !this.halo;
  if (this.onChange) this.onChange();
};
