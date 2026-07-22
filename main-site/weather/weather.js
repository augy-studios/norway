/* Absolutely Norway's /weather page: city picker and forecast rendering. */

(function () {
  "use strict";

  const CITIES = [
    { name: "Oslo", lat: 59.9139, lon: 10.7522 },
    { name: "Bergen", lat: 60.3913, lon: 5.3221 },
    { name: "Trondheim", lat: 63.4305, lon: 10.3951 },
    { name: "Stavanger", lat: 58.97, lon: 5.7331 },
    { name: "Tromsø", lat: 69.6492, lon: 18.9553 },
    { name: "Kristiansand", lat: 58.1467, lon: 7.9956 },
    { name: "Bodø", lat: 67.2804, lon: 14.4049 },
    { name: "Ålesund", lat: 62.4722, lon: 6.1495 },
  ];

  const cache = new Map();
  let currentLabel = CITIES[0].name;
  let currentCoords = { lat: CITIES[0].lat, lon: CITIES[0].lon };

  const els = {
    locationRow: document.getElementById("location-row"),
    loading: document.getElementById("loading-state"),
    error: document.getElementById("error-state"),
    errorMessage: document.getElementById("error-message"),
    errorRetry: document.getElementById("error-retry"),
    empty: document.getElementById("empty-state"),
    content: document.getElementById("content"),
    nowIcon: document.getElementById("now-icon"),
    nowTemp: document.getElementById("now-temp"),
    nowCondition: document.getElementById("now-condition"),
    nowPlace: document.getElementById("now-place"),
    windIcon: document.getElementById("wind-icon"),
    nowWind: document.getElementById("now-wind"),
    humidityIcon: document.getElementById("humidity-icon"),
    nowHumidity: document.getElementById("now-humidity"),
    pressureIcon: document.getElementById("pressure-icon"),
    nowPressure: document.getElementById("now-pressure"),
    precipIcon: document.getElementById("precip-icon"),
    nowPrecip: document.getElementById("now-precip"),
    hourlyScroller: document.getElementById("hourly-scroller"),
    dailyList: document.getElementById("daily-list"),
    updatedNote: document.getElementById("updated-note"),
    backIcon: document.getElementById("back-icon"),
    errorIcon: document.getElementById("error-icon"),
  };

  function symbolToIconKey(symbol) {
    if (!symbol) return "cloudSun";
    const s = symbol.toLowerCase();
    if (s.includes("thunder")) return "cloudLightning";
    if (s.includes("snow") || s.includes("sleet")) return "cloudSnow";
    if (s.includes("rain")) return "cloudRain";
    if (s.includes("fog")) return "cloudFog";
    if (s.includes("cloudy") && !s.includes("partly")) return "cloudOvercast";
    if (s.includes("partlycloudy") || s.includes("fair")) return "cloudSun";
    if (s.includes("clearsky")) return "sun";
    return "cloudSun";
  }

  function symbolToLabel(symbol) {
    if (!symbol) return "Weather unknown";
    const s = symbol.toLowerCase();

    let intensity = "";
    if (s.includes("light")) intensity = "Light ";
    else if (s.includes("heavy")) intensity = "Heavy ";

    const hasThunder = s.includes("thunder");
    const isShowers = s.includes("showers");

    let text;
    if (s.includes("sleet")) {
      text = intensity + "sleet" + (isShowers ? " showers" : "");
    } else if (s.includes("snow")) {
      text = intensity + "snow" + (isShowers ? " showers" : "");
    } else if (s.includes("rain")) {
      text = intensity + "rain" + (isShowers ? " showers" : "");
    } else if (s.includes("fog")) {
      text = "fog";
    } else if (s.includes("cloudy") && !s.includes("partly")) {
      text = "cloudy";
    } else if (s.includes("partlycloudy")) {
      text = "partly cloudy";
    } else if (s.includes("fair")) {
      text = "fair";
    } else if (s.includes("clearsky")) {
      text = "clear sky";
    } else {
      text = "cloudy";
    }

    if (hasThunder) text += " and thunder";

    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function iconSvg(key) {
    const icons = window.NorwayIcons || {};
    return icons[key] || icons.cloudSun || "";
  }

  function injectStaticIcons() {
    const icons = window.NorwayIcons || {};
    els.backIcon.innerHTML = icons.back || "";
    els.errorIcon.innerHTML = icons.alert || "";
    els.windIcon.innerHTML = icons.wind || "";
    els.humidityIcon.innerHTML = icons.droplet || "";
    els.pressureIcon.innerHTML = icons.gauge || "";
    els.precipIcon.innerHTML = icons.cloudRain || "";
  }

  function renderLocationPicker() {
    const icons = window.NorwayIcons || {};
    els.locationRow.innerHTML =
      CITIES.map(
        (c) => '<button type="button" class="location-pill" data-name="' + c.name + '" data-lat="' + c.lat + '" data-lon="' + c.lon + '" aria-pressed="' + (c.name === currentLabel) + '">' + c.name + "</button>"
      ).join("") +
      '<button type="button" class="location-pill locate-btn" id="locate-btn" aria-pressed="false">' + (icons.crosshair || "") + " Use my location</button>";

    els.locationRow.querySelectorAll(".location-pill[data-lat]").forEach((btn) => {
      btn.addEventListener("click", () => {
        setActivePill(btn);
        load(btn.dataset.name, parseFloat(btn.dataset.lat), parseFloat(btn.dataset.lon));
      });
    });

    document.getElementById("locate-btn").addEventListener("click", useMyLocation);
  }

  function setActivePill(activeBtn) {
    els.locationRow.querySelectorAll(".location-pill").forEach((b) => b.setAttribute("aria-pressed", String(b === activeBtn)));
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setState("error");
      els.errorMessage.textContent = "Geolocation isn't available in this browser.";
      return;
    }
    setState("loading");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        setActivePill(document.getElementById("locate-btn"));
        load("Your location", lat, lon);
      },
      (err) => {
        setState("error");
        els.errorMessage.textContent = err.code === err.PERMISSION_DENIED
          ? "Location access was denied. Pick a city instead."
          : "Could not determine your location.";
      },
      { timeout: 8000 }
    );
  }

  function setState(state) {
    els.loading.hidden = state !== "loading";
    els.error.hidden = state !== "error";
    els.empty.hidden = state !== "empty";
    els.content.hidden = state !== "content";
  }

  async function load(label, lat, lon) {
    currentLabel = label;
    currentCoords = { lat, lon };
    setState("loading");

    const cacheKey = lat.toFixed(2) + "," + lon.toFixed(2);
    if (cache.has(cacheKey)) {
      render(label, cache.get(cacheKey));
      return;
    }

    try {
      const res = await fetch("/api/weather?lat=" + lat + "&lon=" + lon);
      const body = await res.json();

      if (!res.ok || !body.success) {
        setState("error");
        els.errorMessage.textContent = body.error || "MET Norway couldn't be reached right now.";
        return;
      }

      if (!body.now || !body.hourly || body.hourly.length === 0) {
        setState("empty");
        return;
      }

      cache.set(cacheKey, body);
      render(label, body);
    } catch (err) {
      setState("error");
      els.errorMessage.textContent = "Could not connect. Check your connection and try again.";
    }
  }

  function render(label, body) {
    setState("content");
    const now = body.now;

    els.nowIcon.innerHTML = iconSvg(symbolToIconKey(now.symbol));
    els.nowTemp.textContent = now.temperature != null ? Math.round(now.temperature) : "-";
    els.nowCondition.textContent = symbolToLabel(now.symbol);
    els.nowPlace.textContent = label;
    els.nowWind.textContent = now.windSpeed != null ? now.windSpeed.toFixed(1) + " m/s" : "-";
    els.nowHumidity.textContent = now.humidity != null ? Math.round(now.humidity) + "%" : "-";
    els.nowPressure.textContent = now.pressure != null ? Math.round(now.pressure) + " hPa" : "-";
    els.nowPrecip.textContent = now.precipitation != null ? now.precipitation.toFixed(1) + " mm/h" : "-";

    els.hourlyScroller.innerHTML = body.hourly
      .map((h) => {
        const t = new Date(h.time);
        const hourLabel = t.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Oslo" });
        return (
          '<div class="hourly-item">' +
          '<div class="hour-label">' + hourLabel + "</div>" +
          iconSvg(symbolToIconKey(h.symbol)) +
          '<div class="hour-temp">' + (h.temperature != null ? Math.round(h.temperature) + "°" : "-") + "</div>" +
          '<div class="hour-condition">' + symbolToLabel(h.symbol) + "</div>" +
          "</div>"
        );
      })
      .join("");

    els.dailyList.innerHTML = body.daily
      .map((d) => {
        // d.date is already the Oslo calendar date (computed server-side); anchor it at
        // UTC noon and render in UTC so the viewer's own timezone can't shift the day.
        const date = new Date(d.date + "T12:00:00Z");
        const label2 = date.toLocaleDateString("en-GB", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
        return (
          '<div class="daily-row">' +
          '<div class="day-label">' + label2 + "</div>" +
          iconSvg(symbolToIconKey(d.symbol)) +
          '<div class="day-condition">' + symbolToLabel(d.symbol) + "</div>" +
          '<div class="day-range">' + (d.max != null ? Math.round(d.max) + "°" : "-") + " / " + (d.min != null ? Math.round(d.min) + "°" : "-") + "</div>" +
          "</div>"
        );
      })
      .join("");

    els.updatedNote.textContent = body.updated
      ? "Forecast issued " + new Date(body.updated).toLocaleString("en-GB", { timeZone: "Europe/Oslo" }) + " CET."
      : "";

    renderUv(body.uv);
  }

  function uvBadgeClass(indexValue) {
    if (indexValue == null) return "badge-ok";
    if (indexValue < 3) return "badge-ok";
    if (indexValue < 6) return "badge-warn";
    return "badge-danger";
  }

  function renderUv(uv) {
    const uvCard = document.getElementById("uv-card");
    const uvSourceNote = document.getElementById("uv-source-note");
    const uvRow = document.getElementById("uv-row");
    if (!uv || (!uv.today && !uv.tomorrow && !uv.dayAfterTomorrow)) {
      uvCard.hidden = true;
      uvSourceNote.hidden = true;
      return;
    }
    uvCard.hidden = false;
    uvSourceNote.hidden = false;

    const days = [
      ["Today", uv.today],
      ["Tomorrow", uv.tomorrow],
      ["Day after", uv.dayAfterTomorrow],
    ];

    uvRow.innerHTML = days
      .filter(([, d]) => d)
      .map(
        ([label, d]) =>
          '<div class="uv-tile">' +
          '<div class="uv-day">' + label + "</div>" +
          '<div class="uv-index">' + d.index.toFixed(1) + "</div>" +
          '<span class="badge ' + uvBadgeClass(d.index) + '">' + (d.classification || "-") + "</span>" +
          "</div>"
      )
      .join("");
  }

  els.errorRetry.addEventListener("click", () => load(currentLabel, currentCoords.lat, currentCoords.lon));

  document.addEventListener("DOMContentLoaded", () => {
    injectStaticIcons();
    renderLocationPicker();
    load(currentLabel, currentCoords.lat, currentCoords.lon);
  });
})();
