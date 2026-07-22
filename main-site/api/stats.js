// Serverless proxy + cache for SSB StatBank table 14700 (Consumer Price Index, total).
// Runs on Vercel's Node runtime. Keeps the upstream query details off the client,
// normalizes the JSON-stat2 payload into a flat series, and adds the safeguards
// a direct browser->SSB call wouldn't have: a request timeout, schema checks,
// a friendly shape for every failure mode, and shared edge caching.

const SSB_URL = "https://data.ssb.no/api/v0/en/table/14700";
const UPSTREAM_TIMEOUT_MS = 8000;
const MIN_MONTHS = 6;
const MAX_MONTHS = 60;
const DEFAULT_MONTHS = 24;

// Best-effort per-instance limiter. Serverless instances are ephemeral and
// multiple may run concurrently, so this does not guarantee a global cap -
// it just stops a single hot instance from hammering SSB's own 40/min limit.
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;
const requestLog = new Map();

function isRateLimited(key) {
  const now = Date.now();
  const timestamps = (requestLog.get(key) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  timestamps.push(now);
  requestLog.set(key, timestamps);
  return timestamps.length > RATE_LIMIT_MAX;
}

function clampMonths(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEFAULT_MONTHS;
  return Math.min(MAX_MONTHS, Math.max(MIN_MONTHS, n));
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function buildQuery(months) {
  return {
    query: [
      { code: "VareTjenesteGrp", selection: { filter: "item", values: ["00"] } },
      { code: "ContentsCode", selection: { filter: "item", values: ["KpiIndMnd", "Tolvmanedersendring"] } },
      { code: "Tid", selection: { filter: "top", values: [String(months)] } },
    ],
    response: { format: "json-stat2" },
  };
}

function normalize(payload) {
  const dim = payload && payload.dimension;
  const tid = dim && dim.Tid && dim.Tid.category;
  const contents = dim && dim.ContentsCode && dim.ContentsCode.category;
  const values = payload && payload.value;

  if (!tid || !contents || !Array.isArray(values)) {
    throw new Error("Unexpected response shape from SSB (missing dimension/value data)");
  }

  const periods = Object.keys(tid.index).sort((a, b) => tid.index[a] - tid.index[b]);
  const contentCodes = Object.keys(contents.index).sort((a, b) => contents.index[a] - contents.index[b]);

  const indexPos = contentCodes.indexOf("KpiIndMnd");
  const yoyPos = contentCodes.indexOf("Tolvmanedersendring");
  if (indexPos === -1 || yoyPos === -1) {
    throw new Error("Expected CPI measures were not present in the SSB response");
  }

  const n = periods.length;
  if (values.length < n * contentCodes.length) {
    throw new Error("SSB response value array shorter than expected - possible schema change");
  }

  const series = periods.map((period, i) => {
    const indexValue = values[indexPos * n + i];
    const yoyValue = values[yoyPos * n + i];
    return {
      period,
      label: period.replace("M", "-"),
      index: typeof indexValue === "number" ? indexValue : null,
      yoyPercent: typeof yoyValue === "number" ? yoyValue : null,
    };
  }).filter((row) => row.index !== null || row.yoyPercent !== null);

  return {
    unit: contents.label && contents.label.KpiIndMnd,
    updated: payload.updated || null,
    source: payload.source || "Statistics Norway (SSB)",
    series,
  };
}

module.exports = async function handler(req, res) {
  const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();

  if (isRateLimited(ip)) {
    res.setHeader("Retry-After", "30");
    return res.status(429).json({
      success: false,
      error: "Too many requests. Please wait a moment and try again.",
    });
  }

  const months = clampMonths(req.query?.months);

  let upstreamRes;
  try {
    upstreamRes = await fetchWithTimeout(
      SSB_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildQuery(months)),
      },
      UPSTREAM_TIMEOUT_MS
    );
  } catch (err) {
    const timedOut = err && err.name === "AbortError";
    return res.status(504).json({
      success: false,
      error: timedOut
        ? "Statistics Norway did not respond in time. Please try again shortly."
        : "Could not reach Statistics Norway.",
    });
  }

  if (!upstreamRes.ok) {
    return res.status(502).json({
      success: false,
      error: `Statistics Norway returned an unexpected status (${upstreamRes.status}).`,
    });
  }

  let payload;
  try {
    payload = await upstreamRes.json();
  } catch {
    return res.status(502).json({ success: false, error: "Statistics Norway returned an invalid response." });
  }

  let normalized;
  try {
    normalized = normalize(payload);
  } catch (err) {
    return res.status(502).json({
      success: false,
      error: "Statistics Norway's data format has changed and could not be read.",
      detail: err.message,
    });
  }

  if (normalized.series.length === 0) {
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json({ success: true, empty: true, series: [], message: "No data available yet." });
  }

  // CPI is published monthly - cache at the edge for an hour, serve stale for a day while revalidating.
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  return res.status(200).json({
    success: true,
    unit: normalized.unit,
    source: normalized.source,
    updated: normalized.updated,
    series: normalized.series,
  });
};
