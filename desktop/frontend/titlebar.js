"use strict";

(() => {
  const appWindow = window.__TAURI__?.window?.getCurrentWindow();
  if (!appWindow) return;

  const minimize = document.getElementById("titlebar-minimize");
  const maximize = document.getElementById("titlebar-maximize");
  const close = document.getElementById("titlebar-close");
  let refreshFrame = 0;

  function refreshMaximizeButton() {
    if (refreshFrame) return;
    refreshFrame = requestAnimationFrame(async () => {
      refreshFrame = 0;
      try {
        const maximized = await appWindow.isMaximized();
        const label = maximized ? "بازگرداندن اندازهٔ پنجره" : "بزرگ کردن پنجره";
        maximize.dataset.maximized = String(maximized);
        maximize.title = label;
        maximize.setAttribute("aria-label", label);
      } catch (error) {
        console.error("Window state could not be read", error);
      }
    });
  }

  minimize.addEventListener("click", () => appWindow.minimize().catch(console.error));
  maximize.addEventListener("click", () => appWindow.toggleMaximize().then(refreshMaximizeButton).catch(console.error));
  close.addEventListener("click", () => appWindow.close().catch(console.error));
  void appWindow.onResized(refreshMaximizeButton).catch(console.error);
  refreshMaximizeButton();
})();
