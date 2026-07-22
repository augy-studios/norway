// Serverless proxy + cache for Norges Bank's open SDMX-JSON data API: spot
// exchange rates against NOK, per-currency rate history, and the key policy
// rate. Normalizes the (fairly involved) SDMX-JSON shape into small flat
// arrays so the client never touches dimension/series-key indexing.

const BASE_URL = "https://data.norges-bank.no/api/data";
const UPSTREAM_TIMEOUT_MS = 8000;

const CURRENCIES = ["USD", "EUR", "GBP", "SEK", "DKK", "JPY", "CHF", "CNY", "SGD"];
const MIN_DAYS = 7;
const MAX_DAYS = 365;
const DEFAULT_DAYS = 90;

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;
const requestLog = new Map();

function isRateLimited(key) {
  const now = Date.now();
  const timestamps = (requestLog.get(key) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  timestamps.push(now);
  requestLog.set(key, timestamps);
  return timestamps.length > RATE_LIMIT_MAX;
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function clampInt(raw, fallback, min, max) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// Flattens one SDMX-JSON dataset into [{ seriesKey, dims: {DIM_ID: value}, observations: [{period, value}] }]
function parseSdmx(payload) {
  const dataset = payload && payload.data && payload.data.dataSets && payload.data.dataSets[0];
  const structure = payload && payload.data && payload.data.structure;
  if (!dataset || !structure) throw new Error("Unexpected SDMX-JSON shape (missing dataSets/structure)");

  const seriesDims = structure.dimensions.series || [];
  const obsDims = structure.dimensions.observation || [];
  const timeValues = (obsDims[0] && obsDims[0].values) || [];

  const series = Object.entries(dataset.series || {}).map(([key, entry]) => {
    const indices = key.split(":").map(Number);
    const dims = {};
    seriesDims.forEach((dim, i) => {
      const val = dim.values[indices[i]];
      dims[dim.id] = val ? val.id : null;
    });
    const observations = Object.entries(entry.observations || {}).map(([obsIdx, obsVal]) => {
      const timeEntry = timeValues[Number(obsIdx)];
      const raw = obsVal && obsVal[0];
      return { period: timeEntry ? timeEntry.id : null, value: raw != null ? parseFloat(raw) : null };
    }).filter((o) => o.period && Number.isFinite(o.value))
      .sort((a, b) => (a.period < b.period ? -1 : 1));
    return { dims, observations };
  });

  return series;
}

module.exports = async function handler(req, res) {
  const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  if (isRateLimited(ip)) {
    res.setHeader("Retry-After", "30");
    return res.status(429).json({ success: false, error: "Too many requests. Please wait a moment and try again." });
  }

  const mode = req.query?.mode === "history" || req.query?.mode === "policy-rate" ? req.query.mode : "rates";

  try {
    if (mode === "rates") {
      const codes = CURRENCIES.join("+");
      const url = `${BASE_URL}/EXR/B.${codes}.NOK.SP?format=sdmx-json&lastNObservations=1&locale=en`;
      const upstream = await fetchWithTimeout(url, UPSTREAM_TIMEOUT_MS);
      if (!upstream.ok) {
        return res.status(502).json({ success: false, error: `Norges Bank returned an unexpected status (${upstream.status}).` });
      }
      const payload = await upstream.json();
      const series = parseSdmx(payload);
      const rates = series
        .map((s) => ({ currency: s.dims.BASE_CUR, ...s.observations[s.observations.length - 1] }))
        .filter((r) => r.currency && r.value != null);

      if (rates.length === 0) {
        res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
        return res.status(200).json({ success: true, empty: true, rates: [] });
      }

      res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=86400");
      return res.status(200).json({ success: true, mode: "rates", rates, updated: rates[0].period });
    }

    if (mode === "history") {
      const currency = String(req.query?.currency || "").toUpperCase();
      if (!CURRENCIES.includes(currency)) {
        return res.status(400).json({ success: false, error: "Unsupported currency. Choose one of: " + CURRENCIES.join(", ") });
      }
      const days = clampInt(req.query?.days, DEFAULT_DAYS, MIN_DAYS, MAX_DAYS);
      const url = `${BASE_URL}/EXR/B.${currency}.NOK.SP?format=sdmx-json&lastNObservations=${days}&locale=en`;
      const upstream = await fetchWithTimeout(url, UPSTREAM_TIMEOUT_MS);
      if (!upstream.ok) {
        return res.status(502).json({ success: false, error: `Norges Bank returned an unexpected status (${upstream.status}).` });
      }
      const payload = await upstream.json();
      const series = parseSdmx(payload);
      const observations = series[0] ? series[0].observations : [];

      if (observations.length === 0) {
        res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
        return res.status(200).json({ success: true, empty: true, currency, observations: [] });
      }

      res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=86400");
      return res.status(200).json({ success: true, mode: "history", currency, observations });
    }

    // policy-rate
    const url = `${BASE_URL}/IR/B.KPRA.SD?format=sdmx-json&lastNObservations=1&locale=en`;
    const upstream = await fetchWithTimeout(url, UPSTREAM_TIMEOUT_MS);
    if (!upstream.ok) {
      return res.status(502).json({ success: false, error: `Norges Bank returned an unexpected status (${upstream.status}).` });
    }
    const payload = await upstream.json();
    const series = parseSdmx(payload);
    const latest = series[0] && series[0].observations[series[0].observations.length - 1];

    if (!latest) {
      res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
      return res.status(200).json({ success: true, empty: true });
    }

    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).json({ success: true, mode: "policy-rate", rate: latest.value, asOf: latest.period });
  } catch (err) {
    const timedOut = err && err.name === "AbortError";
    if (timedOut) {
      return res.status(504).json({ success: false, error: "Norges Bank did not respond in time. Please try again shortly." });
    }
    if (err && /Unexpected SDMX-JSON shape/.test(err.message)) {
      return res.status(502).json({ success: false, error: "Norges Bank's data format has changed and could not be read.", detail: err.message });
    }
    return res.status(502).json({ success: false, error: "Could not reach Norges Bank." });
  }
};
