// ================= dom.js =================
// Страница как источник сцены. Один блок = одна строка.
// Текст хранится ячейками: суррогатные пары (эмодзи) становятся "?".
// Флаги: data-center, data-underlined, data-unselectable,
// data-inactive, data-color (нет флага = нет эффекта).
// BR игнорируется, списки всегда нумерованные.

/**
 * @typedef {Object} Run  Отрезок текста: один набор флагов/цвета подряд
 * @property {string[]} cells  Ячейки, по одной на символ
 * @property {boolean} underlined
 * @property {boolean} unselectable
 * @property {boolean} inactive
 * @property {?string} color  "#RRGGBB" или токен "U<16..23>"
 * @property {?string} url  Адрес ссылки
 */

/**
 * @typedef {Object} ListItem
 * @property {Run[]} runs
 * @property {boolean} center
 */

/**
 * @typedef {Object} Block
 * @property {("rule"|"list"|"title"|"head"|"para")} type
 * @property {Run[]=} runs
 * @property {ListItem[]=} items
 * @property {number=} size
 * @property {boolean=} center
 * @property {("text"|"bright")=} role
 */

// Теги, которые в сцену не попадают
Scene.SKIP_TAGS = { SCRIPT: 1, STYLE: 1, CANVAS: 1, NOSCRIPT: 1, TEMPLATE: 1 };
// Обёртки: сами блоком не становятся, раскрываются в контент
Scene.WRAP_TAGS = {
  DIV: 1, SECTION: 1, ARTICLE: 1, MAIN: 1,
  HEADER: 1, FOOTER: 1, NAV: 1, BLOCKQUOTE: 1
};

/**
 * Сцена: DOM страницы -> блоки. Один блок = одна строка раскладки.
 *
 * @constructor
 */
function Scene() {
  /** @type {Block[]} */
  this.blocks = [];
}

// Рекурсивный обход: флаги, цвет и ссылка наследуются вниз по дереву
Scene.prototype._walkKids = function (el, inhU, inhS, inhI, inhC, inhUrl, out) {
  var kids = el.childNodes || [];
  for (var i = 0; i < kids.length; i++) {
    var n = kids[i];
    if (n.nodeType === 3) {
      var r = { cells: RFONT.toCells(RFONT.cleanText(n.nodeValue)),
        underlined: !!inhU, unselectable: !!inhS, inactive: !!inhI,
        color: inhC };
      if (inhUrl) r.url = inhUrl;
      out.push(r);
    } else if (n.nodeType === 1) {
      var tag = (n.tagName || "").toUpperCase();
      if (tag === "BR") continue;
      var ownU = n.hasAttribute && n.hasAttribute("data-underlined");
      var ownS = n.hasAttribute && n.hasAttribute("data-unselectable");
      var ownI = n.hasAttribute && n.hasAttribute("data-inactive");
      var ownC = n.getAttribute && Palette.parse(n.getAttribute("data-color"));
      var url = (tag === "A" && n.getAttribute && n.getAttribute("href")) ||
        inhUrl || "";
      this._walkKids(n, inhU || ownU, inhS || ownS, inhI || ownI,
        ownC || inhC, url, out);
    }
  }
};

Scene.prototype._runsFromEl = function (el) {
  var runs = [];
  var blockC = el.getAttribute ? Palette.parse(el.getAttribute("data-color")) : null;
  this._walkKids(el, el.hasAttribute && el.hasAttribute("data-underlined"),
    el.hasAttribute && el.hasAttribute("data-unselectable"),
    el.hasAttribute && el.hasAttribute("data-inactive"),
    blockC, "", runs);
  // Пробелы только между отрезками: чистим края строки
  if (runs.length) {
    var first = runs[0].cells;
    while (first.length && first[0] === " ") first.shift();
    var last = runs[runs.length - 1].cells;
    while (last.length && last[last.length - 1] === " ") last.pop();
  }
  // Пустые отрезки выкидываем
  var out = [];
  for (var j = 0; j < runs.length; j++) {
    if (runs[j].cells.length) out.push(runs[j]);
  }
  return out;
};

Scene.prototype._blockFromEl = function (el, acc) {
  var tag = (el.tagName || "").toUpperCase();
  if (Scene.SKIP_TAGS[tag]) return;
  if (Scene.WRAP_TAGS[tag]) {
    var kids = el.children || [];
    for (var i = 0; i < kids.length; i++) this._blockFromEl(kids[i], acc);
    return;
  }
  if (tag === "HR") { acc.push({ type: "rule" }); return; }
  if (tag === "UL" || tag === "OL") { this._listFromEl(el, acc); return; }
  var center = el.hasAttribute ? el.hasAttribute("data-center") : false;
  if (tag === "H1") {
    acc.push({ type: "title", runs: this._runsFromEl(el),
      size: G.TITLE_H, center: center, role: "bright" });
  } else if (tag === "H2" || tag === "H3" || tag === "H4" ||
             tag === "H5" || tag === "H6") {
    acc.push({ type: "head", runs: this._runsFromEl(el),
      size: RFONT.CELL_H, center: center, role: "bright" });
  } else {
    // Неизвестный блочный тег: обычный абзац
    acc.push({ type: "para", runs: this._runsFromEl(el),
      size: RFONT.CELL_H, center: center, role: "text" });
  }
};

// Список: всегда нумерованный, независимо от UL/OL.
// Флаги и цвет наследуются сверху вниз: список -> пункт -> отрезок.
Scene.prototype._listFromEl = function (el, acc) {
  var items = [];
  var lis = el.children || [];
  var ulS = el.hasAttribute ? el.hasAttribute("data-unselectable") : false;
  var ulU = el.hasAttribute ? el.hasAttribute("data-underlined") : false;
  var ulC = el.hasAttribute ? el.hasAttribute("data-center") : false;
  var ulI = el.hasAttribute ? el.hasAttribute("data-inactive") : false;
  var ulCol = el.getAttribute ? Palette.parse(el.getAttribute("data-color")) : null;
  var n = 0;
  for (var j = 0; j < lis.length; j++) {
    if ((lis[j].tagName || "").toUpperCase() !== "LI") continue;
    n++;
    var liS = ulS || (lis[j].hasAttribute && lis[j].hasAttribute("data-unselectable"));
    var liC = ulC || (lis[j].hasAttribute && lis[j].hasAttribute("data-center"));
    var liI = ulI || (lis[j].hasAttribute && lis[j].hasAttribute("data-inactive"));
    var liCol = ulCol ||
      (lis[j].getAttribute && Palette.parse(lis[j].getAttribute("data-color")));
    // Префикс как в CSS-маркерах: никогда не подчёркивается
    var runs = [{ cells: RFONT.toCells(n + ". "), underlined: false,
      unselectable: !!liS, inactive: !!liI, color: liCol || null }];
    var inner = this._runsFromEl(lis[j]);
    for (var k = 0; k < inner.length; k++) {
      inner[k].unselectable = inner[k].unselectable || ulS;
      inner[k].underlined = inner[k].underlined || ulU;
      inner[k].inactive = inner[k].inactive || ulI;
      inner[k].color = inner[k].color || ulCol;
      runs.push(inner[k]);
    }
    items.push({ runs: runs, center: !!liC });
  }
  acc.push({ type: "list", items: items });
};

// Собрать блоки из document.body
Scene.prototype.collect = function () {
  this.blocks = [];
  var kids = document.body.children || [];
  for (var i = 0; i < kids.length; i++) this._blockFromEl(kids[i], this.blocks);
};

// Прячем исходный html: без JS он остаётся видимым
Scene.prototype.hide = function () {
  var kids = document.body.children || [];
  for (var i = 0; i < kids.length; i++) {
    var tag = (kids[i].tagName || "").toUpperCase();
    if (!Scene.SKIP_TAGS[tag] && tag !== "") kids[i].style.display = "none";
  }
};
