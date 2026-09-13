// ================= global.js =================
// Глобальная конфигурация. Грузится первым: остальные файлы опираются на G.
// Это данные, не поведение: классом не оборачивается.
// Цвета (таблица, режимы) живут в scene/colors.js: класс Palette.
// Шрифт и его сетка живут в font/font.js: класс RFONT.

/**
 * @typedef {Object} Config
 * @property {number} TICK_HZ
 * @property {number[]} SCALE_STEPS
 * @property {number[]} SCALE_WIDTHS
 * @property {number} SCALE_GAP
 * @property {number} SAFE_MARGIN
 * @property {number} MIN_VIEW
 * @property {("floor"|"round"|"ceil")} PIX_MODE
 * @property {number} TITLE_H
 * @property {number} RULE_H
 * @property {number} UNDERLINE_H
 * @property {number} BLOCK_GAP
 * @property {number} ITEM_GAP
 * @property {number} SCROLL_STEP
 * @property {number} WHEEL
 * @property {boolean} NEGATIVE
 * @property {number} MULTI_CLICK_MS
 */

/** @type {Config} */
var G = {
  // Тики
  TICK_HZ: 30,              // тиков в секунду

  // Масштаб: шаги и границы ширины (индекс к индексу).
  // Шаг = последний, чья граница <= ширине окна.
  SCALE_STEPS: [1, 2, 3, 4, 5],
  SCALE_WIDTHS: [0, 1280, 2560, 3840, 5120],
  SCALE_GAP: 30,            // гистерезис у границ, px

  // Безопасный запас
  SAFE_MARGIN: 16,          // поля сцены, px
  MIN_VIEW: 8,              // минимальное виртуальное разрешение, px

  // Дроби: как гасить дробную часть пикселя.
  // "floor" (влево/вверх), "round", "ceil". Центрирование всегда влево.
  PIX_MODE: "floor",

  // Типографика сцены (шрифтовая сетка — в RFONT)
  TITLE_H: 32,              // высота заголовка H1, px
  RULE_H: 2,                // толщина линейки, px
  UNDERLINE_H: 1,           // толщина подчёркивания, px
  BLOCK_GAP: 16,            // зазор между блоками, px
  ITEM_GAP: 0,              // добавочный зазор между пунктами списка, px
  SCROLL_STEP: 16,          // шаг прокрутки колесом, px
  WHEEL: 1.0,               // сила колеса мыши, множитель

  // Режим: true = светлый текст на чёрном (негатив), false = наоборот
  NEGATIVE: true,

  // Ввод
  MULTI_CLICK_MS: 300       // окно двойного/тройного клика, мс
};
