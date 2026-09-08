// ================= colors.js =================
// Цвета: таблица RGBI, режимы-индексы, текущая палитра PAL.
// Канонический hex живёт в G.PALETTE; data-color может нести
// произвольный hex (нормализуется к верхнему регистру).

// Таблица: стандартная 16-цветная палитра RGBI (CGA/EGA/VGA).
// 0 black, 1 blue, 2 green, 3 cyan, 4 red, 5 magenta, 6 brown,
// 7 light gray, 8 dark gray, 9 bright blue, 10 bright green,
// 11 bright cyan, 12 bright red, 13 bright magenta, 14 yellow, 15 white.
G.PALETTE = [
  "#000000", "#0000AA", "#00AA00", "#00AAAA",
  "#AA0000", "#AA00AA", "#AA5500", "#AAAAAA",
  "#555555", "#5555FF", "#55FF55", "#55FFFF",
  "#FF5555", "#FF55FF", "#FFFF55", "#FFFFFF"
];

// Имена таблицы для data-color (регистр/пробелы/дефисы не важны).
// white = ярчайший (15); gray без уточнения = тёмный (8).
var COLOR_NAMES = {
  black: 0, blue: 1, green: 2, cyan: 3, red: 4, magenta: 5, brown: 6,
  lightgray: 7, lightgrey: 7, gray: 8, grey: 8, darkgray: 8, darkgrey: 8,
  brightblue: 9, lightblue: 9, brightgreen: 10, lightgreen: 10,
  brightcyan: 11, lightcyan: 11, brightred: 12, lightred: 12,
  brightmagenta: 13, lightmagenta: 13, yellow: 14,
  white: 15, brightwhite: 15
};

// Универсальные цвета u_*: id 16-23, адаптивны к теме.
// Тёмная тема берёт светлый набор, белая — тёмный.
var U_DARK = [15, 9, 10, 11, 12, 13, 14, 7];
var U_LIGHT = [0, 1, 2, 3, 4, 5, 6, 8];
var U_NAMES = {
  ublack: 16, ublue: 17, ugreen: 18, ucyan: 19,
  ured: 20, umagenta: 21, uyellow: 22, ubrown: 22, ugray: 23, ugrey: 23
};

// Значение data-color: hex, id 0-15, имя — в "#RRGGBB";
// id 16-23 и u-имена — в токен "U<id>" (раскрывается темой в runColor).
// Иначе null.
function parseColor(v) {
  var s = String(v).replace(/^\s+|\s+$/g, "");
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return "#" + s.slice(1).toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    return ("#" + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toUpperCase();
  }
  var id;
  if (/^\d+$/.test(s)) {
    id = parseInt(s, 10);
    if (id >= 0 && id < 16) return G.PALETTE[id];
    if (id >= 16 && id < 24) return "U" + id;
    return null;
  }
  var key = s.toLowerCase().replace(/[\s\-_]+/g, "");
  id = COLOR_NAMES[key];
  if (typeof id === "number") return G.PALETTE[id];
  var u = U_NAMES[key];
  return (typeof u === "number") ? "U" + u : null;
}

// Режимы: роли -> индексы PALETTE.
// Тёмный: белый текст на чёрном. Светлый: те же роли на белом,
// оттенки из таблицы с сохранением цветовых семейств.
G.MODE_DARK =  { bg: 0, text: 15, bright: 15, link: 11, visited: 13, rule: 8, inactive: 8 };
G.MODE_LIGHT = { bg: 15, text: 8, bright: 0, link: 3, visited: 5, rule: 7, inactive: 7 };

var PAL = null;

function resolveMode(m) {
  return {
    bg: G.PALETTE[m.bg], text: G.PALETTE[m.text],
    bright: G.PALETTE[m.bright], link: G.PALETTE[m.link],
    visited: G.PALETTE[m.visited], rule: G.PALETTE[m.rule],
    inactive: G.PALETTE[m.inactive]
  };
}

function applyNegative() {
  PAL = resolveMode(G.NEGATIVE ? G.MODE_DARK : G.MODE_LIGHT);
  document.body.style.background = PAL.bg;
  if (cv) cv.style.background = PAL.bg;
  dirty = true;
}

function setNegative(on) {
  G.NEGATIVE = !!on;
  applyNegative();
}
