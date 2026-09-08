// ================= dom.js =================
// Страница как источник сцены. Один блок = одна строка.
// Текст хранится ячейками: суррогатные пары (эмодзи) становятся "?".
// Флаги: data-center, data-underlined, data-unselectable,
// data-inactive, data-color (нет флага = нет эффекта).
// BR игнорируется, списки всегда нумерованные.

var blocks = [];

var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, CANVAS: 1, NOSCRIPT: 1, TEMPLATE: 1 };
var WRAP_TAGS = {
  DIV: 1, SECTION: 1, ARTICLE: 1, MAIN: 1,
  HEADER: 1, FOOTER: 1, NAV: 1, BLOCKQUOTE: 1
};

function cleanText(s) {
  return (s || "").replace(/\s+/g, " ");
}

// Ячейки строит toCells из r_font: walkKids ниже опирается на него.

// Рекурсивный обход: флаги, цвет и ссылка наследуются вниз по дереву
function walkKids(el, inhU, inhS, inhI, inhC, inhUrl, out) {
  var kids = el.childNodes || [];
  for (var i = 0; i < kids.length; i++) {
    var n = kids[i];
    if (n.nodeType === 3) {
      var r = { cells: toCells(cleanText(n.nodeValue)),
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
      var ownC = n.getAttribute && parseColor(n.getAttribute("data-color"));
      var url = (tag === "A" && n.getAttribute && n.getAttribute("href")) ||
        inhUrl || "";
      walkKids(n, inhU || ownU, inhS || ownS, inhI || ownI,
        ownC || inhC, url, out);
    }
  }
}

function runsFromEl(el) {
  var runs = [];
  var blockC = el.getAttribute ? parseColor(el.getAttribute("data-color")) : null;
  walkKids(el, el.hasAttribute && el.hasAttribute("data-underlined"),
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
}

function blockFromEl(el, acc) {
  var tag = (el.tagName || "").toUpperCase();
  if (SKIP_TAGS[tag]) return;
  if (WRAP_TAGS[tag]) {
    var kids = el.children || [];
    for (var i = 0; i < kids.length; i++) blockFromEl(kids[i], acc);
    return;
  }
  if (tag === "HR") { acc.push({ type: "rule" }); return; }
  if (tag === "UL" || tag === "OL") {
    var items = [];
    var lis = el.children || [];
    var ulS = el.hasAttribute ? el.hasAttribute("data-unselectable") : false;
    var ulU = el.hasAttribute ? el.hasAttribute("data-underlined") : false;
    var ulC = el.hasAttribute ? el.hasAttribute("data-center") : false;
    var ulI = el.hasAttribute ? el.hasAttribute("data-inactive") : false;
    var ulCol = el.getAttribute ? parseColor(el.getAttribute("data-color")) : null;
    var n = 0;
    for (var j = 0; j < lis.length; j++) {
      if ((lis[j].tagName || "").toUpperCase() !== "LI") continue;
      n++;
      var liS = ulS || (lis[j].hasAttribute && lis[j].hasAttribute("data-unselectable"));
      var liC = ulC || (lis[j].hasAttribute && lis[j].hasAttribute("data-center"));
      var liI = ulI || (lis[j].hasAttribute && lis[j].hasAttribute("data-inactive"));
      var liCol = ulCol ||
        (lis[j].getAttribute && parseColor(lis[j].getAttribute("data-color")));
      // Префикс как в CSS-маркерах: никогда не подчёркивается
      var runs = [{ cells: toCells(n + ". "), underlined: false,
        unselectable: !!liS, inactive: !!liI, color: liCol || null }];
      var inner = runsFromEl(lis[j]);
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
    return;
  }
  var center = el.hasAttribute ? el.hasAttribute("data-center") : false;
  if (tag === "H1") {
    acc.push({ type: "title", runs: runsFromEl(el),
      size: G.TITLE_H, center: center, role: "bright" });
  } else if (tag === "H2" || tag === "H3" || tag === "H4" ||
             tag === "H5" || tag === "H6") {
    acc.push({ type: "head", runs: runsFromEl(el),
      size: G.CELL_H, center: center, role: "bright" });
  } else {
    // Неизвестный блочный тег: обычный абзац
    acc.push({ type: "para", runs: runsFromEl(el),
      size: G.CELL_H, center: center, role: "text" });
  }
}

function collectBlocks() {
  blocks = [];
  var kids = document.body.children || [];
  for (var i = 0; i < kids.length; i++) blockFromEl(kids[i], blocks);
}

// Прячем исходный html: без JS он остаётся видимым
function hideSource() {
  var kids = document.body.children || [];
  for (var i = 0; i < kids.length; i++) {
    var tag = (kids[i].tagName || "").toUpperCase();
    if (!SKIP_TAGS[tag] && tag !== "") kids[i].style.display = "none";
  }
}
