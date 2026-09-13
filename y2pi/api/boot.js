// ================= boot.js =================
// Загрузчик встраиваемого фреймворка. Страница подключает один
// этот файл, остальное он подтягивает сам из своих подкаталогов.
// Порядок важен: global первым, start последним.
// boot.js и start.js живут в корне api/: от их расположения
// зависят ../fonts/ (через currentScript) и ../api/boot.js в страницах.
//
//   core/   — инфраструктура: G, Scheduler, Viewport
//   font/   — RFONT: шрифтовой движок
//   scene/  — что рисуем: Scene, Palette
//   frame/  — кадр и взаимодействие: Renderer, Selection, Input, Debug

(function () {
  var FILES = ["core/global.js", "scene/colors.js", "font/font.js",
               "core/canvas.js", "core/ticks.js", "scene/dom.js",
               "frame/selection.js", "frame/render.js", "frame/debug.js",
               "frame/input.js", "start.js"];
  var me = document.currentScript;
  var base = (me && me.src) ? me.src.slice(0, me.src.lastIndexOf("/") + 1) : "";
  var host = document.head || document.body || document.documentElement;
  for (var i = 0; i < FILES.length; i++) {
    var s = document.createElement("script");
    s.async = false;
    s.src = base + FILES[i];
    host.appendChild(s);
  }
})();
