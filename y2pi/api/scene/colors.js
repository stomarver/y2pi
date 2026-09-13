// ================= colors.js =================
// Цвета: таблица RGBI, роли-режимы, парсинг data-color, u-цвета.
// Чистая логика без DOM: фон страницы и canvas красит Engine.
// Канонический hex живёт в таблице; data-color может нести
// произвольный hex (нормализуется к верхнему регистру).

/**
 * @typedef {Object} ColorMode  Роли -> индексы таблицы или hex после resolveMode
 * @property {number|string} bg
 * @property {number|string} text
 * @property {number|string} bright
 * @property {number|string} link
 * @property {number|string} visited
 * @property {number|string} rule
 * @property {number|string} inactive
 */

/**
 * Палитра: текущий режим-тема (инстанс) и чистые функции над
 * таблицей (статик): парсинг data-color, раскрытие U-токенов.
 *
 * @constructor
 */
function Palette() {
  /** @type {?ColorMode} */
  this.current = null;  // resolveMode(...): роли в hex
}

// Таблица: стандартная 16-цветная палитра RGBI (CGA/EGA/VGA).
// 0 black, 1 blue, 2 green, 3 cyan, 4 red, 5 magenta, 6 brown,
// 7 light gray, 8 dark gray, 9 bright blue, 10 bright green,
// 11 bright cyan, 12 bright red, 13 bright magenta, 14 yellow, 15 white.
/** @type {string[]} */
Palette.TABLE = [
  "#000000", "#0000AA", "#00AA00", "#00AAAA",
  "#AA0000", "#AA00AA", "#AA5500", "#AAAAAA",
  "#555555", "#5555FF", "#55FF55", "#55FFFF",
  "#FF5555", "#FF55FF", "#FFFF55", "#FFFFFF"
];

// Имена таблицы для data-color (регистр/пробелы/дефисы не важны).
// white = ярчайший (15); gray без уточнения = тёмный (8).
Palette.COLOR_NAMES = {
  black: 0, blue: 1, green: 2, cyan: 3, red: 4, magenta: 5, brown: 6,
  lightgray: 7, lightgrey: 7, gray: 8, grey: 8, darkgray: 8, darkgrey: 8,
  brightblue: 9, lightblue: 9, brightgreen: 10, lightgreen: 10,
  brightcyan: 11, lightcyan: 11, brightred: 12, lightred: 12,
  brightmagenta: 13, lightmagenta: 13, yellow: 14,
  white: 15, brightwhite: 15
};

// Универсальные цвета u_*: id 16-23, адаптивны к теме.
// Тёмная тема берёт светлый набор, белая — тёмный.
/** @type {number[]} */
Palette.U_DARK = [15, 9, 10, 11, 12, 13, 14, 7];
/** @type {number[]} */
Palette.U_LIGHT = [0, 1, 2, 3, 4, 5, 6, 8];
Palette.U_NAMES = {
  ublack: 16, ublue: 17, ugreen: 18, ucyan: 19,
  ured: 20, umagenta: 21, uyellow: 22, ubrown: 22, ugray: 23, ugrey: 23
};

// Режимы: роли -> индексы таблицы.
// Тёмный: белый текст на чёрном. Светлый: те же роли на белом,
// оттенки из таблицы с сохранением цветовых семейств.
Palette.MODE_DARK =  { bg: 0, text: 15, bright: 15, link: 11, visited: 13, rule: 8, inactive: 8 };
Palette.MODE_LIGHT = { bg: 15, text: 8, bright: 0, link: 3, visited: 5, rule: 7, inactive: 7 };

/**
 * Значение data-color: hex, id 0-15, имя — в "#RRGGBB";
 * id 16-23 и u-имена — в токен "U<id>" (раскрывается темой в resolve).
 * Иначе null.
 * @param {?string} v
 * @returns {?string}
 */
Palette.parse = function (v) {
  var s = String(v).replace(/^\s+|\s+$/g, "");
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return "#" + s.slice(1).toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    return ("#" + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toUpperCase();
  }
  var id;
  if (/^\d+$/.test(s)) {
    id = parseInt(s, 10);
    if (id >= 0 && id < 16) return Palette.TABLE[id];
    if (id >= 16 && id < 24) return "U" + id;
    return null;
  }
  var key = s.toLowerCase().replace(/[\s\-_]+/g, "");
  id = Palette.COLOR_NAMES[key];
  if (typeof id === "number") return Palette.TABLE[id];
  var u = Palette.U_NAMES[key];
  return (typeof u === "number") ? "U" + u : null;
};

/**
 * Роли в hex.
 * @param {{bg:number, text:number, bright:number, link:number,
 *          visited:number, rule:number, inactive:number}} m
 * @returns {ColorMode}
 */
Palette.resolveMode = function (m) {
  return {
    bg: Palette.TABLE[m.bg], text: Palette.TABLE[m.text],
    bright: Palette.TABLE[m.bright], link: Palette.TABLE[m.link],
    visited: Palette.TABLE[m.visited], rule: Palette.TABLE[m.rule],
    inactive: Palette.TABLE[m.inactive]
  };
};

/**
 * Сменить тему и пересчитать текущую палитру.
 * @param {boolean} on  true = светлый текст на чёрном
 */
Palette.prototype.setNegative = function (on) {
  G.NEGATIVE = !!on;
  this.current = Palette.resolveMode(
    G.NEGATIVE ? Palette.MODE_DARK : Palette.MODE_LIGHT);
};

/**
 * Токен "U<id>" -> hex текущей темы; hex проходит как есть.
 * @param {string} c
 * @returns {string}
 */
Palette.resolve = function (c) {
  if (c.charAt(0) === "U") {
    var set = G.NEGATIVE ? Palette.U_DARK : Palette.U_LIGHT;
    return Palette.TABLE[set[parseInt(c.slice(1), 10) - 16]];
  }
  return c;
};
