/* Absolutely Norway's shared UI helpers: icon hydration and modal show/hide. */

(function () {
  "use strict";

  // Safe to call repeatedly; re-renders when data-icon changes.
  function hydrateIcons(root) {
    (root || document).querySelectorAll("[data-icon]").forEach(function (el) {
      var name = el.dataset.icon;
      if (el.dataset.iconRendered === name) return;
      el.innerHTML = window.NorwayIcon(name);
      el.dataset.iconRendered = name;
    });
  }

  function openModal(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.classList.remove("hidden");
    document.body.classList.add("modal-open");
  }

  function closeModal(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.classList.add("hidden");
    if (!document.querySelector(".modal-backdrop:not(.hidden)")) {
      document.body.classList.remove("modal-open");
    }
  }

  window.NorwayUI = {
    hydrateIcons: hydrateIcons,
    openModal: openModal,
    closeModal: closeModal,
  };
})();
