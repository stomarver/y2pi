// ================= boot.js =================
// Загрузчик встраиваемого фреймворка. Страница подключает один
// этот файл, остальное он подтягивает сам из своего каталога.
// Порядок важен: global первым, start последним.

(function () {
  var FILES = ["global.js", "colors.js", "r_font.js", "canvas.js",
               "ticks.js", "render.js", "dom.js", "input.js", "debug.js", "start.js"];
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
