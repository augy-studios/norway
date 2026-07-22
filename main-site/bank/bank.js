/* Absolutely Norway's /bank page: rates, converter, policy rate, and history chart. */

(function () {
  "use strict";

  const historyCache = new Map();
  let ratesMap = { NOK: 1 };
  let activeCurrency = "USD";

  const els = {
    loading: document.getElementById("loading-state"),
    error: document.getElementById("error-state"),
    errorMessage: document.getElementById("error-message"),
    errorRetry: document.getElementById("error-retry"),
    content: document.getElementById("content"),
    policyRate: document.getElementById("policy-rate"),
    policyRateDate: document.getElementById("policy-rate-date"),
    usdRate: document.getElementById("usd-rate"),
    ratesUpdated: document.getElementById("rates-updated"),
    amountInput: document.getElementById("amount-input"),
    fromSelect: document.getElementById("from-select"),
    toSelect: document.getElementById("to-select"),
    swapBtn: document.getElementById("swap-btn"),
    converterResult: document.getElementById("converter-result"),
    ratesList: document.getElementById("rates-list"),
    chart: document.getElementById("rate-chart"),
    chartTitle: document.getElementById("chart-title"),
    tooltip: document.getElementById("chart-tooltip"),
    backIcon: document.getElementById("back-icon"),
    errorIcon: document.getElementById("error-icon"),
  };

  function injectIcons() {
    const icons = window.NorwayIcons || {};
    els.backIcon.innerHTML = icons.back || "";
    els.errorIcon.innerHTML = icons.alert || "";
    els.swapBtn.innerHTML = icons.refresh || "";
  }

  function setState(state) {
    els.loading.hidden = state !== "loading";
    els.error.hidden = state !== "error";
    els.content.hidden = state !== "content";
  }

  async function init() {
    setState("loading");
    try {
      const [ratesRes, policyRes] = await Promise.all([
        fetch("/api/bank?mode=rates").then((r) => r.json()),
        fetch("/api/bank?mode=policy-rate").then((r) => r.json()),
      ]);

      if (!ratesRes.success || ratesRes.empty) {
        setState("error");
        els.errorMessage.textContent = ratesRes.error || "No exchange rate data available right now.";
        return;
      }

      ratesMap = { NOK: 1 };
      ratesRes.rates.forEach((r) => { ratesMap[r.currency] = r.value; });

      setState("content");
      renderRates(ratesRes);
      renderPolicyRate(policyRes);
      renderConverterOptions();
      updateConverter();
      loadHistory(activeCurrency);
    } catch (err) {
      setState("error");
      els.errorMessage.textContent = "Could not connect. Check your connection and try again.";
    }
  }

  function renderPolicyRate(policyRes) {
    if (policyRes && policyRes.success && !policyRes.empty) {
      els.policyRate.textContent = policyRes.rate.toFixed(2);
      els.policyRateDate.textContent = "As of " + policyRes.asOf;
    } else {
      els.policyRate.textContent = "-";
      els.policyRateDate.textContent = "Unavailable right now";
    }
  }

  function renderRates(ratesRes) {
    const usd = ratesRes.rates.find((r) => r.currency === "USD");
    els.usdRate.textContent = usd ? usd.value.toFixed(2) : "-";
    els.ratesUpdated.textContent = "As of " + ratesRes.updated;

    els.ratesList.innerHTML = ratesRes.rates
      .map(
        (r) =>
          '<button type="button" class="rate-row" data-currency="' + r.currency + '" aria-pressed="' + (r.currency === activeCurrency) + '">' +
          '<span class="rate-currency">' + r.currency + "</span>" +
          '<span class="rate-value">' + r.value.toFixed(4) + " NOK</span>" +
          "</button>"
      )
      .join("");

    els.ratesList.querySelectorAll(".rate-row").forEach((row) => {
      row.addEventListener("click", () => {
        activeCurrency = row.dataset.currency;
        els.ratesList.querySelectorAll(".rate-row").forEach((r) => r.setAttribute("aria-pressed", String(r === row)));
        loadHistory(activeCurrency);
      });
    });
  }

  function renderConverterOptions() {
    const codes = ["NOK", ...Object.keys(ratesMap).filter((c) => c !== "NOK")];
    const opts = codes.map((c) => '<option value="' + c + '">' + c + "</option>").join("");
    els.fromSelect.innerHTML = opts;
    els.toSelect.innerHTML = opts;
    els.fromSelect.value = "USD";
    els.toSelect.value = "NOK";
    els.fromSelect.addEventListener("change", updateConverter);
    els.toSelect.addEventListener("change", updateConverter);
    els.amountInput.addEventListener("input", updateConverter);
    els.swapBtn.addEventListener("click", () => {
      const a = els.fromSelect.value;
      els.fromSelect.value = els.toSelect.value;
      els.toSelect.value = a;
      updateConverter();
    });
  }

  function updateConverter() {
    const amount = parseFloat(els.amountInput.value);
    const from = els.fromSelect.value;
    const to = els.toSelect.value;
    if (!Number.isFinite(amount) || !ratesMap[from] || !ratesMap[to]) {
      els.converterResult.textContent = "Enter a valid amount.";
      return;
    }
    const inNok = amount * ratesMap[from];
    const result = inNok / ratesMap[to];
    els.converterResult.innerHTML =
      amount.toLocaleString() + " " + from + " = <strong>" + result.toLocaleString(undefined, { maximumFractionDigits: 2 }) + " " + to + "</strong>" +
      '<span class="rate-note">1 ' + from + " = " + (ratesMap[from] / ratesMap[to]).toFixed(4) + " " + to + "</span>";
  }

  async function loadHistory(currency) {
    els.chartTitle.textContent = currency + " / NOK history";
    if (historyCache.has(currency)) {
      drawChart(historyCache.get(currency));
      return;
    }
    try {
      const res = await fetch("/api/bank?mode=history&currency=" + currency + "&days=90");
      const body = await res.json();
      if (!body.success || body.empty || !body.observations || body.observations.length === 0) {
        els.chart.innerHTML = '<text x="10" y="30" class="chart-axis-label">No history available.</text>';
        return;
      }
      historyCache.set(currency, body.observations);
      drawChart(body.observations);
    } catch {
      els.chart.innerHTML = '<text x="10" y="30" class="chart-axis-label">Could not load history.</text>';
    }
  }

  function drawChart(observations) {
    const svg = els.chart;
    const width = 640;
    const height = 220;
    const padding = { top: 12, right: 12, bottom: 24, left: 12 };
    const values = observations.map((d) => d.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    const innerW = width - padding.left - padding.right;
    const innerH = height - padding.top - padding.bottom;

    function x(i) {
      return padding.left + (i / (observations.length - 1 || 1)) * innerW;
    }
    function y(v) {
      return padding.top + innerH - ((v - min) / range) * innerH;
    }

    const path = observations
      .map((d, i) => (i === 0 ? "M" : "L") + x(i).toFixed(1) + "," + y(d.value).toFixed(1))
      .join(" ");

    const labelStep = Math.max(1, Math.ceil(observations.length / 6));
    let svgMarkup = '<path class="chart-line" d="' + path + '"></path>';
    observations.forEach((d, i) => {
      if (i % labelStep === 0 || i === observations.length - 1) {
        svgMarkup += '<text class="chart-axis-label" x="' + x(i).toFixed(1) + '" y="' + (height - 6) + '" text-anchor="middle">' + d.period.slice(5) + "</text>";
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
      let idx = Math.round(((relX - padding.left) / innerW) * (observations.length - 1));
      idx = Math.max(0, Math.min(observations.length - 1, idx));
      const d = observations[idx];
      const px = x(idx);
      const py = y(d.value);
      crosshair.setAttribute("x1", px);
      crosshair.setAttribute("x2", px);
      crosshair.style.opacity = "1";
      dot.setAttribute("cx", px);
      dot.setAttribute("cy", py);
      dot.style.opacity = "1";
      tooltip.style.opacity = "1";
      tooltip.style.left = (px / width) * 100 + "%";
      tooltip.style.top = (py / height) * 100 + "%";
      tooltip.innerHTML = "<strong>" + d.period + "</strong>" + d.value.toFixed(4) + " NOK";
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

  els.errorRetry.addEventListener("click", init);

  document.addEventListener("DOMContentLoaded", () => {
    injectIcons();
    init();
  });
})();
