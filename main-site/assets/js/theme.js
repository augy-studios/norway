/* Absolutely Norway's shared theme picker and service worker registration.
   The theme is also applied by a tiny inline script in <head>, before this
   file loads, so the page never flashes the wrong colour. */

(function () {
  "use strict";

  const STORAGE_KEY = "norway-theme";
  const DEFAULT_THEME = "classic";

  const THEMES = [
    { id: "classic", label: "Classic", hex: "#ccffcc" },
    { id: "not-green-1", label: "Not green 1", hex: "#ffcccc" },
    { id: "not-green-2", label: "Not green 2", hex: "#ccccff" },
    { id: "not-green-3", label: "Not green 3", hex: "#ffffcc" },
    { id: "not-green-4", label: "Not green 4", hex: "#ffccff" },
    { id: "not-green-5", label: "Not green 5", hex: "#ccffff" },
    { id: "really-light-green", label: "Really really light green", hex: "#ffffff" },
  ];

  function applyTheme(id) {
    const theme = THEMES.find((t) => t.id === id) ? id : DEFAULT_THEME;
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (e) {
      /* localStorage unavailable (private mode / disabled) - theme just won't persist */
    }
    document.querySelectorAll("[data-theme-meta]").forEach((meta) => {
      const t = THEMES.find((x) => x.id === theme);
      if (t) meta.setAttribute("content", t.hex);
    });
  }

  function getStoredTheme() {
    try {
      return localStorage.getItem(STORAGE_KEY) || DEFAULT_THEME;
    } catch (e) {
      return DEFAULT_THEME;
    }
  }

  function buildThemeModal() {
    const overlay = document.getElementById("theme-modal");
    if (!overlay) return;
    const grid = overlay.querySelector(".theme-grid");
    if (!grid) return;

    grid.innerHTML = "";
    THEMES.forEach((theme) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "theme-swatch";
      btn.dataset.themeId = theme.id;
      btn.setAttribute("aria-pressed", String(theme.id === getStoredTheme()));
      btn.innerHTML =
        '<span class="swatch-dot" style="background:' + theme.hex + '"></span>' +
        "<span>" + theme.label + "</span>" +
        '<svg class="icon swatch-check" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
        '<path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
        "</svg>";
      btn.addEventListener("click", () => {
        applyTheme(theme.id);
        grid.querySelectorAll(".theme-swatch").forEach((b) => {
          b.setAttribute("aria-pressed", String(b.dataset.themeId === theme.id));
        });
      });
      grid.appendChild(btn);
    });
  }

  function setupModal() {
    const overlay = document.getElementById("theme-modal");
    const openBtn = document.getElementById("theme-toggle");
    const closeBtn = overlay ? overlay.querySelector(".modal-close") : null;
    if (!overlay || !openBtn) return;

    function open() {
      overlay.hidden = false;
      // Force layout so the browser sees the pre-transition state before we
      // flip the class, otherwise it skips straight to the end state.
      overlay.getBoundingClientRect();
      overlay.classList.add("is-open");
      const firstSwatch = overlay.querySelector(".theme-swatch");
      if (firstSwatch) firstSwatch.focus();
      document.addEventListener("keydown", onKeydown);
    }

    function close() {
      overlay.classList.remove("is-open");
      openBtn.focus();
      document.removeEventListener("keydown", onKeydown);
      const onTransitionEnd = (e) => {
        if (e.target !== overlay) return;
        overlay.hidden = true;
        overlay.removeEventListener("transitionend", onTransitionEnd);
      };
      overlay.addEventListener("transitionend", onTransitionEnd);
    }

    function onKeydown(e) {
      if (e.key === "Escape") close();
    }

    openBtn.addEventListener("click", open);
    if (closeBtn) closeBtn.addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
  }

  function injectSharedIcons() {
    const icons = window.NorwayIcons;
    if (!icons) return;
    const themeToggle = document.getElementById("theme-toggle");
    if (themeToggle) themeToggle.innerHTML = icons.palette;
    const modalClose = document.querySelector("#theme-modal .modal-close");
    if (modalClose) modalClose.innerHTML = icons.close;
    document.querySelectorAll(".btn-coffee").forEach((btn) => {
      btn.insertAdjacentHTML("afterbegin", icons.coffee);
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    injectSharedIcons();
    buildThemeModal();
    setupModal();
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* offline-first is a nicety, not a requirement - ignore registration failures */
      });
    });
  }

  window.NorwayTheme = { THEMES, applyTheme, getStoredTheme };
})();
