// Serverless proxy + cache for MET Norway's Locationforecast API. MET requires
// every client to send an identifying User-Agent (unidentified traffic gets
// throttled or blocked), so this also keeps that detail off the browser.
// Normalizes the (fairly deep) JSON into a flat now/hourly/daily shape and
// caches according to MET's own Expires header instead of a fixed TTL.

const MET_URL = "https://api.met.no/weatherapi/locationforecast/2.0/compact";
const NILU_UV_URL = "https://api.nilu.no/uv/forecast";
const USER_AGENT = "AbsolutelyNorway/1.0 (+https://norway.uwuapps.org)";
const UPSTREAM_TIMEOUT_MS = 8000;
const MIN_CACHE_S = 300;
const MAX_CACHE_S = 3600;

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
    return await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function parseCoord(raw, min, max) {
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  // MET recommends limiting precision so nearby requests share cache entries.
  return Math.round(n * 10000) / 10000;
}

const OSLO_TZ = "Europe/Oslo";
const osloDateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: OSLO_TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const osloHourFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: OSLO_TZ, hour: "2-digit", hour12: false });

// Norway runs on one timezone (CET/CEST), so days and "midday" are grouped by
// Oslo local time rather than the UTC date in the raw timestamp - otherwise a
// 23:00 UTC entry (already tomorrow in Oslo) would land in the wrong day.
function dateKey(isoTime) {
  return osloDateFormatter.format(new Date(isoTime));
}

function osloHour(isoTime) {
  return parseInt(osloHourFormatter.format(new Date(isoTime)), 10);
}

function normalize(payload) {
  const series = payload && payload.properties && payload.properties.timeseries;
  if (!Array.isArray(series) || series.length === 0) {
    throw new Error("Unexpected response shape from MET Norway (missing timeseries)");
  }

  function entryFrom(point) {
    const details = point.data && point.data.instant && point.data.instant.details;
    if (!details) return null;
    const next1 = point.data.next_1_hours;
    const next6 = point.data.next_6_hours;
    const symbol = (next1 && next1.summary && next1.summary.symbol_code) ||
      (next6 && next6.summary && next6.summary.symbol_code) || null;
    return {
      time: point.time,
      temperature: typeof details.air_temperature === "number" ? details.air_temperature : null,
      windSpeed: typeof details.wind_speed === "number" ? details.wind_speed : null,
      humidity: typeof details.relative_humidity === "number" ? details.relative_humidity : null,
      pressure: typeof details.air_pressure_at_sea_level === "number" ? details.air_pressure_at_sea_level : null,
      precipitation: next1 && next1.details && typeof next1.details.precipitation_amount === "number"
        ? next1.details.precipitation_amount
        : null,
      symbol,
    };
  }

  const points = series.map(entryFrom).filter(Boolean);
  if (points.length === 0) {
    throw new Error("MET Norway response had no usable instant-detail entries");
  }

  const now = points[0];
  const hourly = points.slice(0, 24);

  const byDay = new Map();
  points.forEach((p) => {
    const key = dateKey(p.time);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(p);
  });

  const daily = Array.from(byDay.entries())
    .slice(0, 7)
    .map(([date, entries]) => {
      const temps = entries.map((e) => e.temperature).filter((t) => t != null);
      const midday = entries.find((e) => osloHour(e.time) === 12) || entries[Math.floor(entries.length / 2)];
      return {
        date,
        min: temps.length ? Math.min(...temps) : null,
        max: temps.length ? Math.max(...temps) : null,
        symbol: midday ? midday.symbol : entries[0].symbol,
      };
    });

  return { updated: payload.properties.meta?.updated_at || null, now, hourly, daily };
}

// UV is a supplementary enrichment from a different NILU subsystem than air
// quality - if it fails for any reason we just omit it, we don't fail the
// whole weather response over it.
async function fetchUv(lat, lon) {
  try {
    const upstream = await fetchWithTimeout(`${NILU_UV_URL}/${lat}/${lon}`, UPSTREAM_TIMEOUT_MS);
    if (!upstream.ok) return null;
    const payload = await upstream.json();
    const forecast = payload && Array.isArray(payload.forecasts) && payload.forecasts[0];
    const classifications = payload && Array.isArray(payload.classifications) ? payload.classifications : [];
    if (!forecast) return null;

    // The API only returns Norwegian classification names; ids are a stable 1-5 enum, so translate by id.
    const CLASSIFICATION_EN = { 1: "Low", 2: "Moderate", 3: "High", 4: "Very high", 5: "Extreme" };

    function peakOf(dayEntries) {
      if (!Array.isArray(dayEntries) || dayEntries.length === 0) return null;
      const withIndex = dayEntries.filter((e) => typeof e.index === "number");
      if (withIndex.length === 0) return null;
      const peak = withIndex.reduce((a, b) => (b.index > a.index ? b : a));
      const cls = classifications.find((c) => c.id === peak.classification);
      return { index: peak.index, classification: CLASSIFICATION_EN[peak.classification] || (cls ? cls.name : null) };
    }

    return {
      today: peakOf(forecast.today),
      tomorrow: peakOf(forecast.tomorrow),
      dayAfterTomorrow: peakOf(forecast.dayAfterTomorrow),
    };
  } catch {
    return null;
  }
}

module.exports = async function handler(req, res) {
  const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  if (isRateLimited(ip)) {
    res.setHeader("Retry-After", "30");
    return res.status(429).json({ success: false, error: "Too many requests. Please wait a moment and try again." });
  }

  const lat = parseCoord(req.query?.lat, -90, 90);
  const lon = parseCoord(req.query?.lon, -180, 180);
  if (lat === null || lon === null) {
    return res.status(400).json({ success: false, error: "Provide valid lat/lon query parameters." });
  }

  let upstream;
  try {
    upstream = await fetchWithTimeout(`${MET_URL}?lat=${lat}&lon=${lon}`, UPSTREAM_TIMEOUT_MS);
  } catch (err) {
    const timedOut = err && err.name === "AbortError";
    return res.status(504).json({
      success: false,
      error: timedOut ? "MET Norway did not respond in time. Please try again shortly." : "Could not reach MET Norway.",
    });
  }

  if (upstream.status === 429) {
    res.setHeader("Retry-After", "60");
    return res.status(429).json({ success: false, error: "MET Norway is rate-limiting this server. Please try again in a minute." });
  }
  if (!upstream.ok) {
    return res.status(502).json({ success: false, error: `MET Norway returned an unexpected status (${upstream.status}).` });
  }

  let payload;
  try {
    payload = await upstream.json();
  } catch {
    return res.status(502).json({ success: false, error: "MET Norway returned an invalid response." });
  }

  let normalized;
  try {
    normalized = normalize(payload);
  } catch (err) {
    return res.status(502).json({
      success: false,
      error: "MET Norway's data format has changed and could not be read.",
      detail: err.message,
    });
  }

  let maxAge = MIN_CACHE_S;
  const expiresHeader = upstream.headers.get("expires");
  if (expiresHeader) {
    const secs = Math.floor((new Date(expiresHeader).getTime() - Date.now()) / 1000);
    if (Number.isFinite(secs) && secs > 0) maxAge = Math.min(MAX_CACHE_S, Math.max(MIN_CACHE_S, secs));
  }

  const uv = await fetchUv(lat, lon);

  res.setHeader("Cache-Control", `public, s-maxage=${maxAge}, stale-while-revalidate=86400`);
  return res.status(200).json({ success: true, lat, lon, uv, ...normalized });
};
