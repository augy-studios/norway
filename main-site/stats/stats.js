/* Absolutely Norway — /stats page: fetch, render, chart + table for SSB CPI data. */

(function () {
  "use strict";

  const cache = new Map(); // in-session cache so switching ranges back and forth doesn't refetch
  let currentSeries = [];
  let currentMonths = 24;

  const els = {
    loading: document.getElementById("loading-state"),
    error: document.getElementById("error-state"),
    errorMessage: document.getElementById("error-message"),
    errorRetry: document.getElementById("error-retry"),
    empty: document.getElementById("empty-state"),
    content: document.getElementById("content"),
    statIndex: document.getElementById("stat-index"),
    indexPeriod: document.getElementById("index-period"),
    statYoy: document.getElementById("stat-yoy"),
    yoyTrend: document.getElementById("yoy-trend"),
    chart: document.getElementById("cpi-chart"),
    tooltip: document.getElementById("chart-tooltip"),
    tableToggle: document.getElementById("table-toggle"),
    tableWrap: document.getElementById("table-wrap"),
    tableBody: document.getElementById("table-body"),
    updatedNote: document.getElementById("updated-note"),
    rangeButtons: Array.from(document.querySelectorAll(".range-btn")),
    backIcon: document.getElementById("back-icon"),
    errorIcon: document.getElementById("error-icon"),
  };

  function setState(state) {
    els.loading.hidden = state !== "loading";
    els.error.hidden = state !== "error";
    els.empty.hidden = state !== "empty";
    els.content.hidden = state !== "content";
  }

  function injectIcons() {
    const icons = window.NorwayIcons;
    if (!icons) return;
    if (els.backIcon) els.backIcon.innerHTML = icons.back;
    if (els.errorIcon) els.errorIcon.innerHTML = icons.alert;
  }

  async function load(months) {
    currentMonths = months;
    setState("loading");

    if (cache.has(months)) {
      render(cache.get(months));
      return;
    }

    try {
      const res = await fetch("/api/stats?months=" + months);
      const body = await res.json();

      if (!res.ok || !body.success) {
        setState("error");
        els.errorMessage.textContent = body.error || "Statistics Norway couldn't be reached right now.";
        return;
      }

      if (body.empty || !body.series || body.series.length === 0) {
        setState("empty");
        return;
      }

      cache.set(months, body);
      render(body);
    } catch (err) {
      setState("error");
      els.errorMessage.textContent = "Could not connect. Check your connection and try again.";
    }
  }

  function render(body) {
    currentSeries = body.series;
    setState("content");

    const last = body.series[body.series.length - 1];
    els.statIndex.textContent = last.index != null ? last.index.toFixed(1) : "—";
    els.indexPeriod.textContent = last.label;

    els.statYoy.textContent = last.yoyPercent != null ? (last.yoyPercent > 0 ? "+" : "") + last.yoyPercent.toFixed(1) : "—";
    const prev = body.series[body.series.length - 2];
    const icons = window.NorwayIcons || {};
    els.yoyTrend.innerHTML = "";
    if (prev && last.yoyPercent != null && prev.yoyPercent != null) {
      const up = last.yoyPercent >= prev.yoyPercent;
      els.yoyTrend.classList.toggle("is-up", up);
      els.yoyTrend.classList.toggle("is-down", !up);
      els.yoyTrend.innerHTML = (icons.trendUp || "") + "<span>vs " + prev.label + "</span>";
    }

    els.updatedNote.textContent = body.updated ? "Table last updated " + new Date(body.updated).toLocaleDateString() + "." : "";

    drawChart(body.series);
    renderTable(body.series);
  }

  function drawChart(series) {
    const svg = els.chart;
    const width = 640;
    const height = 220;
    const padding = { top: 12, right: 12, bottom: 24, left: 12 };
    const values = series.map((d) => d.yoyPercent).filter((v) => v != null);
    const min = Math.min(...values, 0);
    const max = Math.max(...values, 0);
    const range = max - min || 1;

    const innerW = width - padding.left - padding.right;
    const innerH = height - padding.top - padding.bottom;

    function x(i) {
      return padding.left + (i / (series.length - 1 || 1)) * innerW;
    }
    function y(v) {
      return padding.top + innerH - ((v - min) / range) * innerH;
    }

    const points = series.map((d, i) => [x(i), d.yoyPercent != null ? y(d.yoyPercent) : null]);
    const path = points
      .filter(([, py]) => py != null)
      .map(([px, py], idx) => (idx === 0 ? "M" : "L") + px.toFixed(1) + "," + py.toFixed(1))
      .join(" ");

    const zeroY = y(0).toFixed(1);
    const labelStep = Math.max(1, Math.ceil(series.length / 6));

    let svgMarkup =
      '<line class="chart-gridline" x1="' + padding.left + '" y1="' + zeroY + '" x2="' + (width - padding.right) + '" y2="' + zeroY + '"></line>' +
      '<path class="chart-line" d="' + path + '"></path>';

    series.forEach((d, i) => {
      if (i % labelStep === 0 || i === series.length - 1) {
        svgMarkup += '<text class="chart-axis-label" x="' + x(i).toFixed(1) + '" y="' + (height - 6) + '" text-anchor="middle">' + d.label + "</text>";
      }
    });

    svgMarkup +=
      '<line class="chart-crosshair" id="chart-crosshair" x1="0" y1="' + padding.top + '" x2="0" y2="' + (height - padding.bottom) + '"></line>' +
      '<circle class="chart-dot" id="chart-dot" r="4"></circle>';

    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.innerHTML = svgMarkup;

    const crosshair = svg.querySelector("#chart-crosshair");
    const dot = svg.querySelector("#chart-dot");
    const tooltip = els.tooltip;

    function onMove(evt) {
      const rect = svg.getBoundingClientRect();
      const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
      const relX = ((clientX - rect.left) / rect.width) * width;
      let idx = Math.round(((relX - padding.left) / innerW) * (series.length - 1));
      idx = Math.max(0, Math.min(series.length - 1, idx));
      const d = series[idx];
      if (d.yoyPercent == null) return;

      const px = x(idx);
      const py = y(d.yoyPercent);
      crosshair.setAttribute("x1", px);
      crosshair.setAttribute("x2", px);
      crosshair.style.opacity = "1";
      dot.setAttribute("cx", px);
      dot.setAttribute("cy", py);
      dot.style.opacity = "1";

      tooltip.style.opacity = "1";
      tooltip.style.left = (px / width) * 100 + "%";
      tooltip.style.top = (py / height) * 100 + "%";
      tooltip.innerHTML = "<strong>" + d.label + "</strong>" + d.yoyPercent.toFixed(1) + "% 12-month rate";
    }

    function onLeave() {
      crosshair.style.opacity = "0";
      dot.style.opacity = "0";
      tooltip.style.opacity = "0";
    }

    svg.addEventListener("mousemove", onMove);
    svg.addEventListener("mouseleave", onLeave);
    svg.addEventListener("touchmove", onMove, { passive: true });
    svg.addEventListener("touchend", onLeave);
  }

  function renderTable(series) {
    els.tableBody.innerHTML = series
      .slice()
      .reverse()
      .map(
        (d) =>
          "<tr><td>" + d.label + "</td><td>" + (d.index != null ? d.index.toFixed(1) : "—") + "</td><td>" +
          (d.yoyPercent != null ? d.yoyPercent.toFixed(1) : "—") + "</td></tr>"
      )
      .join("");
  }

  els.rangeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      els.rangeButtons.forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      load(parseInt(btn.dataset.months, 10));
    });
  });

  els.errorRetry.addEventListener("click", () => load(currentMonths));

  els.tableToggle.addEventListener("click", () => {
    const isHidden = els.tableWrap.hidden;
    els.tableWrap.hidden = !isHidden;
    els.tableToggle.setAttribute("aria-expanded", String(isHidden));
    els.tableToggle.textContent = isHidden ? "Hide table" : "Show table";
  });

  document.addEventListener("DOMContentLoaded", () => {
    injectIcons();
    load(currentMonths);
  });
})();
