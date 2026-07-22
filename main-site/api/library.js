// Serverless proxy + cache for the National Library of Norway's catalogue
// search (api.nb.no). Required here, not just convenient: the upstream API's
// CORS policy only allows requests from nb.no's own origin, so the browser
// cannot call it directly from this site - every request must go through
// this function. Normalizes the HAL+JSON payload into a flat result list.

const BASE_URL = "https://api.nb.no/catalog/v1/items";
const UPSTREAM_TIMEOUT_MS = 8000;
const DEFAULT_SIZE = 12;
const MAX_SIZE = 24;

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

function normalizeItem(item) {
  if (!item || !item.metadata) throw new Error("Unexpected item shape from Nasjonalbiblioteket");
  const m = item.metadata;
  const links = item._links || {};
  const urn = m.identifiers && m.identifiers.urn;
  return {
    id: item.id,
    title: m.title || "(untitled)",
    creators: Array.isArray(m.creators) ? m.creators : [],
    year: (m.originInfo && m.originInfo.issued) || null,
    mediaTypes: Array.isArray(m.mediaTypes) ? m.mediaTypes : [],
    isPublicDomain: !!(item.accessInfo && item.accessInfo.isPublicDomain),
    viewable: !!(item.accessInfo && item.accessInfo.viewability === "ALL"),
    license: (item.accessInfo && item.accessInfo.license) || null,
    thumbnail: links.thumbnail_medium ? links.thumbnail_medium.href : null,
    viewUrl: urn ? `https://urn.nb.no/${encodeURIComponent(urn)}` : null,
  };
}

module.exports = async function handler(req, res) {
  const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  if (isRateLimited(ip)) {
    res.setHeader("Retry-After", "30");
    return res.status(429).json({ success: false, error: "Too many requests. Please wait a moment and try again." });
  }

  const q = typeof req.query?.q === "string" ? req.query.q.trim() : "";
  if (q.length < 2) {
    return res.status(400).json({ success: false, error: "Type at least 2 characters to search." });
  }

  const page = clampInt(req.query?.page, 0, 0, 100000);
  const size = clampInt(req.query?.size, DEFAULT_SIZE, 1, MAX_SIZE);
  const digitalOnly = req.query?.digitalOnly !== "false";

  const url = `${BASE_URL}?q=${encodeURIComponent(q)}&page=${page}&size=${size}${digitalOnly ? "&digitalAccessibleOnly=true" : ""}`;

  let upstream;
  try {
    upstream = await fetchWithTimeout(url, UPSTREAM_TIMEOUT_MS);
  } catch (err) {
    const timedOut = err && err.name === "AbortError";
    return res.status(504).json({
      success: false,
      error: timedOut ? "Nasjonalbiblioteket did not respond in time. Please try again shortly." : "Could not reach Nasjonalbiblioteket.",
    });
  }

  if (!upstream.ok) {
    return res.status(502).json({ success: false, error: `Nasjonalbiblioteket returned an unexpected status (${upstream.status}).` });
  }

  let payload;
  try {
    payload = await upstream.json();
  } catch {
    return res.status(502).json({ success: false, error: "Nasjonalbiblioteket returned an invalid response." });
  }

  const rawItems = (payload && payload._embedded && payload._embedded.items) || [];
  let results;
  try {
    results = rawItems.map(normalizeItem);
  } catch (err) {
    return res.status(502).json({
      success: false,
      error: "Nasjonalbiblioteket's data format has changed and could not be read.",
      detail: err.message,
    });
  }

  const pageInfo = payload && payload.page
    ? { number: payload.page.number, size: payload.page.size, totalElements: payload.page.totalElements, totalPages: payload.page.totalPages }
    : { number: page, size, totalElements: results.length, totalPages: results.length ? 1 : 0 };

  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  return res.status(200).json({ success: true, results, page: pageInfo });
};
