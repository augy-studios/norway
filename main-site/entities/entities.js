/* Absolutely Norway's /entities page: search and lookup against Brreg via /api/entities. */

(function () {
  "use strict";

  const ORGNR_RE = /^\d{9}$/;
  const DEBOUNCE_MS = 400;
  const PAGE_SIZE = 10;

  let debounceTimer = null;
  let currentQuery = "";
  let currentPage = 0;
  let lastRequestId = 0;

  const els = {
    input: document.getElementById("entity-search"),
    idle: document.getElementById("idle-state"),
    loading: document.getElementById("loading-state"),
    error: document.getElementById("error-state"),
    errorMessage: document.getElementById("error-message"),
    errorRetry: document.getElementById("error-retry"),
    empty: document.getElementById("empty-state"),
    emptyMessage: document.getElementById("empty-message"),
    resultsView: document.getElementById("results-view"),
    resultsList: document.getElementById("results-list"),
    paginationRow: document.getElementById("pagination-row"),
    prevPage: document.getElementById("prev-page"),
    nextPage: document.getElementById("next-page"),
    pageLabel: document.getElementById("page-label"),
    detailView: document.getElementById("detail-view"),
    detailName: document.getElementById("detail-name"),
    detailOrgnr: document.getElementById("detail-orgnr"),
    detailBadges: document.getElementById("detail-badges"),
    detailGrid: document.getElementById("detail-grid"),
    detailIcon: document.getElementById("detail-icon"),
    backToResults: document.getElementById("back-to-results"),
    backIcon: document.getElementById("back-icon"),
    detailBackIcon: document.getElementById("detail-back-icon"),
    searchIcon: document.getElementById("search-icon"),
    errorIcon: document.getElementById("error-icon"),
  };

  function injectIcons() {
    const icons = window.NorwayIcons;
    if (!icons) return;
    els.backIcon.innerHTML = icons.back;
    els.detailBackIcon.innerHTML = icons.back;
    els.searchIcon.innerHTML = icons.search;
    els.errorIcon.innerHTML = icons.alert;
  }

  function showPanel(name) {
    els.idle.hidden = name !== "idle";
    els.loading.hidden = name !== "loading";
    els.error.hidden = name !== "error";
    els.empty.hidden = name !== "empty";
    els.resultsView.hidden = name !== "results";
    els.detailView.hidden = name !== "detail";
  }

  async function runSearch(query, page) {
    const requestId = ++lastRequestId;
    currentQuery = query;
    currentPage = page;
    showPanel("loading");

    try {
      const url = ORGNR_RE.test(query)
        ? "/api/entities?orgnr=" + encodeURIComponent(query)
        : "/api/entities?q=" + encodeURIComponent(query) + "&page=" + page + "&size=" + PAGE_SIZE;

      const res = await fetch(url);
      const body = await res.json();
      if (requestId !== lastRequestId) return; // a newer keystroke superseded this request

      if (!res.ok || !body.success) {
        if (res.status === 404) {
          showPanel("empty");
          els.emptyMessage.textContent = body.error || "No matches found.";
          return;
        }
        showPanel("error");
        els.errorMessage.textContent = body.error || "Brreg couldn't be reached right now.";
        return;
      }

      if (body.mode === "lookup") {
        renderDetail(body.entity);
        return;
      }

      if (!body.results || body.results.length === 0) {
        showPanel("empty");
        els.emptyMessage.textContent = "No companies matched \"" + query + "\".";
        return;
      }

      renderResults(body.results, body.page);
    } catch (err) {
      if (requestId !== lastRequestId) return;
      showPanel("error");
      els.errorMessage.textContent = "Could not connect. Check your connection and try again.";
    }
  }

  function renderResults(results, page) {
    showPanel("results");
    const icons = window.NorwayIcons || {};
    els.resultsList.innerHTML = results
      .map(
        (r) =>
          '<button type="button" class="entity-row glass" data-orgnr="' + r.orgNumber + '">' +
          '<span class="entity-row-icon">' + (icons.pin || "") + "</span>" +
          '<span class="entity-row-main">' +
          '<span class="entity-row-name">' + escapeHtml(r.name) + "</span>" +
          '<span class="entity-row-meta">' + r.orgNumber + (r.orgForm ? " · " + escapeHtml(r.orgForm.description) : "") +
          (r.businessAddress && r.businessAddress.city ? " · " + escapeHtml(r.businessAddress.city) : "") +
          "</span></span></button>"
      )
      .join("");

    els.resultsList.querySelectorAll(".entity-row").forEach((row) => {
      row.addEventListener("click", () => runSearch(row.dataset.orgnr, 0));
    });

    const totalPages = page.totalPages || 1;
    els.paginationRow.hidden = totalPages <= 1;
    els.pageLabel.textContent = "Page " + (page.number + 1) + " of " + totalPages;
    els.prevPage.disabled = page.number <= 0;
    els.nextPage.disabled = page.number + 1 >= totalPages;
  }

  function renderDetail(entity) {
    showPanel("detail");
    const icons = window.NorwayIcons || {};
    els.detailIcon.innerHTML = icons.pin || "";
    els.detailName.textContent = entity.name;
    els.detailOrgnr.textContent = "Org number " + entity.orgNumber;

    const badges = [];
    if (entity.bankrupt) badges.push('<span class="badge badge-danger">' + (icons.alert || "") + " Bankrupt</span>");
    if (entity.winding) badges.push('<span class="badge badge-warn">' + (icons.alert || "") + " Winding up</span>");
    if (!entity.bankrupt && !entity.winding) badges.push('<span class="badge badge-ok">' + (icons.check || "") + " Active</span>");
    if (entity.vatRegistered) badges.push('<span class="badge badge-ok">VAT registered</span>');
    els.detailBadges.innerHTML = badges.join("");

    const addr = entity.businessAddress || entity.postalAddress;
    const fields = [
      ["Organisation form", entity.orgForm ? entity.orgForm.description + " (" + entity.orgForm.code + ")" : "-"],
      ["Industry", entity.industry ? entity.industry.description : "-"],
      ["Registered", entity.registeredDate || "-"],
      ["Employees", entity.employees != null ? String(entity.employees) : "-"],
      ["Address", addr ? [...(addr.lines || []), addr.postalCode, addr.city].filter(Boolean).join(", ") : "-"],
      ["Website", entity.website ? '<a href="https://' + entity.website.replace(/^https?:\/\//, "") + '" target="_blank" rel="noopener noreferrer">' + entity.website + "</a>" : "-"],
    ];
    els.detailGrid.innerHTML = fields
      .map(([label, value]) => '<div class="detail-field"><div class="field-label">' + label + '</div><div class="field-value">' + value + "</div></div>")
      .join("");
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  els.input.addEventListener("input", (e) => {
    const value = e.target.value.trim();
    clearTimeout(debounceTimer);
    if (!value) {
      lastRequestId++;
      showPanel("idle");
      return;
    }
    if (!ORGNR_RE.test(value) && value.length < 2) return;
    debounceTimer = setTimeout(() => runSearch(value, 0), ORGNR_RE.test(value) ? 0 : DEBOUNCE_MS);
  });

  els.input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    clearTimeout(debounceTimer);
    const value = els.input.value.trim();
    if (!value || (!ORGNR_RE.test(value) && value.length < 2)) return;
    runSearch(value, 0);
  });

  els.errorRetry.addEventListener("click", () => runSearch(currentQuery, currentPage));
  els.prevPage.addEventListener("click", () => runSearch(currentQuery, Math.max(0, currentPage - 1)));
  els.nextPage.addEventListener("click", () => runSearch(currentQuery, currentPage + 1));
  els.backToResults.addEventListener("click", () => {
    const value = els.input.value.trim();
    if (!value) {
      showPanel("idle");
      return;
    }
    runSearch(value, 0);
  });

  document.addEventListener("DOMContentLoaded", injectIcons);
})();
