/* Absolutely Norway's service worker registration and update bar.
   Registers /sw.js once for the whole site, and when a new version has been
   downloaded and is waiting, draws a slim bar at the top of the page offering
   Reload and Not now. Nothing reloads until the reader asks for it. */

(function () {
  "use strict";

  var SW_URL = "/sw.js";

  var STRINGS = {
    label: "Update",
    ready: "A new version of There's Absolutely Norway is ready.",
    reload: "Reload",
    later: "Not now",
  };

  var registration = null;
  var waitingWorker = null;
  var reloading = false;
  // For this page view only, never stored. "Not now" means not now.
  var dismissed = false;

  function render() {
    var existing = document.querySelector(".update-notice");

    if (!waitingWorker || dismissed) {
      if (existing) existing.remove();
      return;
    }

    var bar = existing || document.createElement("div");
    bar.className = "update-notice";
    // status, not alert: nothing is wrong, so nobody gets interrupted.
    bar.setAttribute("role", "status");
    bar.setAttribute("aria-label", STRINGS.label);
    bar.textContent = "";

    var inner = document.createElement("div");
    inner.className = "update-notice-inner";

    var text = document.createElement("p");
    text.textContent = STRINGS.ready;

    var reloadBtn = document.createElement("button");
    reloadBtn.type = "button";
    reloadBtn.className = "btn btn-primary";
    reloadBtn.setAttribute("data-sw-update", "");
    reloadBtn.textContent = STRINGS.reload;
    reloadBtn.addEventListener("click", function () {
      // The only place anything asks for skipWaiting. The reload happens on
      // controllerchange, not here.
      if (waitingWorker) waitingWorker.postMessage("skip-waiting");
    });

    var laterBtn = document.createElement("button");
    laterBtn.type = "button";
    laterBtn.className = "btn";
    laterBtn.setAttribute("data-sw-later", "");
    laterBtn.textContent = STRINGS.later;
    laterBtn.addEventListener("click", function () {
      dismissed = true;
      render();
    });

    inner.appendChild(text);
    inner.appendChild(reloadBtn);
    inner.appendChild(laterBtn);
    bar.appendChild(inner);

    if (!existing) document.body.prepend(bar);
  }

  function watchForUpdate() {
    if (!registration) return;

    // A worker already waiting when the page opened. This is the ordinary case
    // on the second page view after a deploy, and without it the prompt would
    // only ever reach somebody who happened to have the page open at the
    // moment the new worker finished installing.
    if (registration.waiting && navigator.serviceWorker.controller) {
      waitingWorker = registration.waiting;
      render();
    }

    registration.addEventListener("updatefound", function () {
      var installing = registration.installing;
      if (!installing) return;

      installing.addEventListener("statechange", function () {
        // `installed` with a controller present means an update. `installed`
        // with no controller is a first install, which has nothing to prompt
        // about: there is no previous version on screen to protect.
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          waitingWorker = registration.waiting || installing;
          render();
        }
      });
    });

    // The browser checks for a new worker on navigation and roughly daily.
    // A tab left open since Tuesday sees neither, and the reader comes back
    // to it by switching to the tab, so ask again then. This only downloads
    // and installs; nothing activates or reloads without the bar.
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "visible") return;
      registration.update().catch(function () {
        /* offline, or the server is unreachable: nothing to do */
      });
    });
  }

  function registerWorker() {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker
      .register(SW_URL)
      .then(function (reg) {
        registration = reg;
        watchForUpdate();
      })
      .catch(function (cause) {
        // A refused registration is not a reason to break the page. Private
        // browsing in some browsers, and any http origin that is not
        // localhost, land here. Offline-first is a nicety, not a requirement.
        console.warn("service worker registration failed:", cause);
      });

    // The swap, once somebody has accepted it. Reloading here rather than in
    // the click handler is what makes the page come back on the new version:
    // the controller has changed by this point, so the reload is served by
    // the new worker and not the one being replaced.
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
  }

  // Registration on `load`, not immediately: installing fetches everything
  // the worker precaches, and starting that while the page is still fetching
  // its own assets is how a service worker makes a first visit slower for no
  // gain.
  if (document.readyState === "complete") registerWorker();
  else window.addEventListener("load", registerWorker, { once: true });
})();
