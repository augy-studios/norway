/* Absolutely Norway's shared theme: 7 brand colour swatches + light/dark mode.
   Default is always light + classic (#ccffcc), regardless of OS preference.
   Once the user picks something, it is persisted.
   Also registers the service worker. */

(function () {
  "use strict";

  var APP_KEY = "norway";

  var COLOR_THEMES = [
    { id: "classic", label: "Classic", hex: "#ccffcc" },
    { id: "not-green-1", label: "Not green 1", hex: "#ffcccc" },
    { id: "not-green-2", label: "Not green 2", hex: "#ccccff" },
    { id: "not-green-3", label: "Not green 3", hex: "#ffffcc" },
    { id: "not-green-4", label: "Not green 4", hex: "#ffccff" },
    { id: "not-green-5", label: "Not green 5", hex: "#ccffff" },
    { id: "really-light-green", label: "Really really light green", hex: "#ffffff" },
  ];

  var STORAGE_KEY_COLOR = APP_KEY + ".colorTheme";
  var STORAGE_KEY_MODE = APP_KEY + ".mode";
  var LEGACY_KEY = "norway-theme";

  function read(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      /* localStorage unavailable (private mode / disabled), so it just won't persist */
    }
  }

  // The old single-axis key held a swatch id, so it maps straight across.
  // Mode has no predecessor and falls back to light.
  function migrateLegacy() {
    var legacy = read(LEGACY_KEY);
    if (!legacy) return;
    if (!read(STORAGE_KEY_COLOR) && findTheme(legacy)) {
      write(STORAGE_KEY_COLOR, legacy);
    }
    try {
      localStorage.removeItem(LEGACY_KEY);
    } catch (e) {
      /* nothing to do */
    }
  }

  function findTheme(id) {
    for (var i = 0; i < COLOR_THEMES.length; i++) {
      if (COLOR_THEMES[i].id === id) return COLOR_THEMES[i];
    }
    return null;
  }

  function hexToRgb(hex) {
    var n = parseInt(hex.replace("#", ""), 16);
    return ((n >> 16) & 255) + ", " + ((n >> 8) & 255) + ", " + (n & 255);
  }

  function getStoredColorTheme() {
    return read(STORAGE_KEY_COLOR) || "classic";
  }

  function getStoredMode() {
    return read(STORAGE_KEY_MODE) || "light";
  }

  function applyColorTheme(id) {
    var theme = findTheme(id) || COLOR_THEMES[0];
    document.documentElement.setAttribute("data-color-theme", theme.id);
    document.documentElement.style.setProperty("--brand", theme.hex);
    document.documentElement.style.setProperty("--brand-rgb", hexToRgb(theme.hex));
    write(STORAGE_KEY_COLOR, theme.id);
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) {
      metas[i].setAttribute("content", theme.hex);
    }
    return theme;
  }

  function applyMode(mode) {
    var resolved = mode === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-mode", resolved);
    write(STORAGE_KEY_MODE, resolved);
    return resolved;
  }

  function initTheme() {
    migrateLegacy();
    applyColorTheme(getStoredColorTheme());
    applyMode(getStoredMode());
  }

  /* -- Theme modal ---------------------------------------------------------- */

  function buildThemeModal() {
    var grid = document.getElementById("swatchGrid");
    if (!grid) return;

    grid.innerHTML = COLOR_THEMES.map(function (t) {
      return (
        '<button class="swatch" data-theme-id="' + t.id + '" style="--swatch-color:' + t.hex +
        '" type="button" aria-label="' + t.label + '">' +
        '<span class="swatch-dot"></span>' +
        '<span class="swatch-label">' + t.label + "</span>" +
        "</button>"
      );
    }).join("");

    syncThemeModalState();

    grid.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-theme-id]");
      if (!btn) return;
      applyColorTheme(btn.dataset.themeId);
      syncThemeModalState();
    });

    var toggle = document.getElementById("modeToggle");
    if (toggle) {
      toggle.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-mode]");
        if (!btn) return;
        applyMode(btn.dataset.mode);
        syncThemeModalState();
      });
    }
  }

  function syncThemeModalState() {
    var activeTheme = getStoredColorTheme();
    var activeMode = getStoredMode();
    document.querySelectorAll("#swatchGrid .swatch").forEach(function (el) {
      el.classList.toggle("active", el.dataset.themeId === activeTheme);
    });
    document.querySelectorAll("#modeToggle .mode-btn").forEach(function (el) {
      var on = el.dataset.mode === activeMode;
      el.classList.toggle("active", on);
      el.setAttribute("aria-pressed", String(on));
    });
    updateThemeButtonIcon();
  }

  function updateThemeButtonIcon() {
    var btn = document.getElementById("themeBtn");
    if (!btn) return;
    var span = btn.querySelector("[data-icon]");
    if (!span) return;
    span.setAttribute("data-icon", getStoredMode() === "dark" ? "moon" : "sun");
    window.NorwayUI.hydrateIcons(btn);
  }

  function wireModals() {
    var ui = window.NorwayUI;
    var themeBtn = document.getElementById("themeBtn");
    var lastTrigger = null;

    function onKeydown(e) {
      if (e.key !== "Escape") return;
      var open = document.querySelector(".modal-backdrop:not(.hidden)");
      if (open) close(open.id);
    }

    function open(id) {
      lastTrigger = document.activeElement;
      ui.openModal(id);
      document.addEventListener("keydown", onKeydown);
      var modal = document.getElementById(id);
      var first = modal.querySelector(".swatch") || modal.querySelector("button");
      if (first) first.focus();
    }

    function close(id) {
      ui.closeModal(id);
      document.removeEventListener("keydown", onKeydown);
      if (lastTrigger && lastTrigger.focus) lastTrigger.focus();
    }

    document.querySelectorAll("[data-close-modal]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        close(btn.dataset.closeModal);
      });
    });

    document.querySelectorAll(".modal-backdrop").forEach(function (backdrop) {
      backdrop.addEventListener("click", function (e) {
        if (e.target === backdrop) close(backdrop.id);
      });
    });

    if (themeBtn) {
      themeBtn.addEventListener("click", function () {
        open("themeModal");
      });
    }
  }

  initTheme();

  document.addEventListener("DOMContentLoaded", function () {
    window.NorwayUI.hydrateIcons();
    updateThemeButtonIcon();
    buildThemeModal();
    wireModals();
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function () {
        /* offline-first is a nicety, not a requirement, so ignore failures */
      });
    });
  }

  window.NorwayTheme = {
    COLOR_THEMES: COLOR_THEMES,
    applyColorTheme: applyColorTheme,
    applyMode: applyMode,
    getStoredColorTheme: getStoredColorTheme,
    getStoredMode: getStoredMode,
    initTheme: initTheme,
  };
})();
