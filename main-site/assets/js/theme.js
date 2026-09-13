/* Absolutely Norway's shared theme: 7 brand colour swatches + light/dark mode,
   with an optional time-based mode that follows the device clock.
   Default is always light + classic (#ccffcc), regardless of OS preference.
   Once the user picks something, it is persisted.
   Service worker registration lives in update.js. */

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

  /* Mode preference and mode are different things. The preference is what the
     person chose and can be "time"; the mode is what the document is in and
     is only ever light or dark. */

  var MODE_PREFERENCES = ["light", "dark", "time"];

  /* The daylight window. Duplicated in the pre-paint script in every head,
     which has to resolve this before first paint and cannot import anything.
     Change both together. */
  var LIGHT_FROM_HOUR = 9;
  var LIGHT_UNTIL_HOUR = 18;

  function getModePreference() {
    var v = read(STORAGE_KEY_MODE);
    return MODE_PREFERENCES.indexOf(v) !== -1 ? v : "light";
  }

  function isDaylightHours(now) {
    var hour = (now || new Date()).getHours();
    return hour >= LIGHT_FROM_HOUR && hour < LIGHT_UNTIL_HOUR;
  }

  function resolveMode(preference) {
    if (preference === "time") return isDaylightHours() ? "light" : "dark";
    return preference === "dark" ? "dark" : "light";
  }

  // The mode the document is in right now, resolved. What the theme button
  // icon and anything else reading the active mode wants.
  function getStoredMode() {
    return resolveMode(getModePreference());
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

  function applyMode(preference) {
    var chosen = MODE_PREFERENCES.indexOf(preference) !== -1 ? preference : "light";
    var resolved = resolveMode(chosen);

    document.documentElement.setAttribute("data-mode", resolved);
    document.documentElement.setAttribute("data-mode-preference", chosen);
    write(STORAGE_KEY_MODE, chosen);

    scheduleModeCheck();

    return resolved;
  }

  /* Keeping the time based mode honest while the page stays open. */

  var modeTimer = null;
  var watchingVisibility = false;

  // Milliseconds until the next 09:00 or 18:00, whichever comes first.
  function msUntilNextBoundary(now) {
    now = now || new Date();
    var next = new Date(now);
    next.setMinutes(0, 0, 0);

    var hour = now.getHours();
    if (hour < LIGHT_FROM_HOUR) {
      next.setHours(LIGHT_FROM_HOUR);
    } else if (hour < LIGHT_UNTIL_HOUR) {
      next.setHours(LIGHT_UNTIL_HOUR);
    } else {
      next.setDate(next.getDate() + 1);
      next.setHours(LIGHT_FROM_HOUR);
    }

    // A second of slack, so a timer that fires a fraction early does not land
    // back in the hour it just left and reschedule itself in a tight loop.
    return Math.max(1000, next.getTime() - now.getTime() + 1000);
  }

  function scheduleModeCheck() {
    if (modeTimer !== null) {
      clearTimeout(modeTimer);
      modeTimer = null;
    }

    if (getModePreference() !== "time") return;

    modeTimer = setTimeout(function () {
      modeTimer = null;
      refreshTimeMode();
    }, msUntilNextBoundary());

    if (!watchingVisibility && typeof document !== "undefined") {
      watchingVisibility = true;
      document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "visible") refreshTimeMode();
      });
    }
  }

  function refreshTimeMode() {
    if (getModePreference() !== "time") return;

    var resolved = resolveMode("time");
    var current = document.documentElement.getAttribute("data-mode");

    if (resolved !== current) {
      document.documentElement.setAttribute("data-mode", resolved);
      document.dispatchEvent(
        new CustomEvent("uwu:modechange", {
          detail: { mode: resolved, preference: "time" },
        })
      );
    }

    scheduleModeCheck();
  }

  function initTheme() {
    migrateLegacy();
    applyColorTheme(getStoredColorTheme());
    // The preference, not the resolved mode. Passing the resolved one would
    // quietly rewrite a stored "time" into "dark" the first evening.
    applyMode(getModePreference());
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

    // A tab left open across 09:00 or 18:00 re-resolves itself; redraw the
    // modal so the note and pressed state stay in step with the change.
    document.addEventListener("uwu:modechange", syncThemeModalState);
  }

  function syncThemeModalState() {
    var activeTheme = getStoredColorTheme();
    var activePreference = getModePreference();
    var resolvedMode = getStoredMode();

    document.querySelectorAll("#swatchGrid .swatch").forEach(function (el) {
      el.classList.toggle("active", el.dataset.themeId === activeTheme);
    });
    document.querySelectorAll("#modeToggle .mode-btn").forEach(function (el) {
      var on = el.dataset.mode === activePreference;
      el.classList.toggle("active", on);
      el.setAttribute("aria-pressed", String(on));
    });

    var note = document.getElementById("modeNote");
    if (note) {
      note.hidden = activePreference !== "time";
      if (activePreference === "time") {
        note.textContent = "Following the clock. Currently " + resolvedMode + ".";
      }
    }

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

  window.NorwayTheme = {
    COLOR_THEMES: COLOR_THEMES,
    MODE_PREFERENCES: MODE_PREFERENCES,
    LIGHT_FROM_HOUR: LIGHT_FROM_HOUR,
    LIGHT_UNTIL_HOUR: LIGHT_UNTIL_HOUR,
    applyColorTheme: applyColorTheme,
    applyMode: applyMode,
    getStoredColorTheme: getStoredColorTheme,
    getStoredMode: getStoredMode,
    getModePreference: getModePreference,
    isDaylightHours: isDaylightHours,
    resolveMode: resolveMode,
    refreshTimeMode: refreshTimeMode,
    initTheme: initTheme,
  };
})();
