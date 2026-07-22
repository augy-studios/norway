/* Absolutely Norway's /library page: search the National Library catalogue via /api/library. */

(function () {
  "use strict";

  const DEBOUNCE_MS = 400;
  const PAGE_SIZE = 12;

  let debounceTimer = null;
  let currentQuery = "";
  let currentPage = 0;

  const els = {
    input: document.getElementById("library-search"),
    idle: document.getElementById("idle-state"),
    loading: document.getElementById("loading-state"),
    error: document.getElementById("error-state"),
    errorMessage: document.getElementById("error-message"),
    errorRetry: document.getElementById("error-retry"),
    empty: document.getElementById("empty-state"),
    emptyMessage: document.getElementById("empty-message"),
    resultsView: document.getElementById("results-view"),
    resultsGrid: document.getElementById("results-grid"),
    paginationRow: document.getElementById("pagination-row"),
    prevPage: document.getElementById("prev-page"),
    nextPage: document.getElementById("next-page"),
    pageLabel: document.getElementById("page-label"),
    backIcon: document.getElementById("back-icon"),
    searchIcon: document.getElementById("search-icon"),
    errorIcon: document.getElementById("error-icon"),
  };

  function injectIcons() {
    const icons = window.NorwayIcons || {};
    els.backIcon.innerHTML = icons.back || "";
    els.searchIcon.innerHTML = icons.search || "";
    els.errorIcon.innerHTML = icons.alert || "";
  }

  function showPanel(name) {
    els.idle.hidden = name !== "idle";
    els.loading.hidden = name !== "loading";
    els.error.hidden = name !== "error";
    els.empty.hidden = name !== "empty";
    els.resultsView.hidden = name !== "results";
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  async function runSearch(query, page) {
    currentQuery = query;
    currentPage = page;
    showPanel("loading");

    try {
      const res = await fetch("/api/library?q=" + encodeURIComponent(query) + "&page=" + page + "&size=" + PAGE_SIZE);
      const body = await res.json();

      if (!res.ok || !body.success) {
        showPanel("error");
        els.errorMessage.textContent = body.error || "Nasjonalbiblioteket couldn't be reached right now.";
        return;
      }

      if (!body.results || body.results.length === 0) {
        showPanel("empty");
        els.emptyMessage.textContent = "No items matched \"" + query + "\".";
        return;
      }

      renderResults(body.results, body.page);
    } catch (err) {
      showPanel("error");
      els.errorMessage.textContent = "Could not connect. Check your connection and try again.";
    }
  }

  function renderResults(results, page) {
    showPanel("results");
    const icons = window.NorwayIcons || {};

    els.resultsGrid.innerHTML = results
      .map((r) => {
        const thumb = r.thumbnail
          ? '<img src="' + r.thumbnail + '" alt="" loading="lazy">'
          : icons.book || "";
        const badges = [];
        if (r.isPublicDomain) badges.push('<span class="badge badge-ok">Public domain</span>');
        if (r.mediaTypes[0]) badges.push('<span class="badge badge-muted">' + escapeHtml(r.mediaTypes[0]) + "</span>");
        return (
          '<article class="item-card glass">' +
          '<div class="item-thumb">' + thumb + "</div>" +
          '<div class="item-title">' + escapeHtml(r.title) + "</div>" +
          '<div class="item-meta">' + (r.creators.length ? escapeHtml(r.creators.join(", ")) + " · " : "") + (r.year || "n.d.") + "</div>" +
          '<div class="item-badges">' + badges.join("") + "</div>" +
          (r.viewUrl ? '<a class="item-link" href="' + r.viewUrl + '" target="_blank" rel="noopener noreferrer">View at nb.no →</a>' : "") +
          "</article>"
        );
      })
      .join("");

    const totalPages = page.totalPages || 1;
    els.paginationRow.hidden = totalPages <= 1;
    els.pageLabel.textContent = "Page " + (page.number + 1) + " of " + totalPages.toLocaleString();
    els.prevPage.disabled = page.number <= 0;
    els.nextPage.disabled = page.number + 1 >= totalPages;
  }

  els.input.addEventListener("input", (e) => {
    const value = e.target.value.trim();
    clearTimeout(debounceTimer);
    if (!value) {
      showPanel("idle");
      return;
    }
    if (value.length < 2) return;
    debounceTimer = setTimeout(() => runSearch(value, 0), DEBOUNCE_MS);
  });

  els.errorRetry.addEventListener("click", () => runSearch(currentQuery, currentPage));
  els.prevPage.addEventListener("click", () => runSearch(currentQuery, Math.max(0, currentPage - 1)));
  els.nextPage.addEventListener("click", () => runSearch(currentQuery, currentPage + 1));

  document.addEventListener("DOMContentLoaded", injectIcons);
})();
