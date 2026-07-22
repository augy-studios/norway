// Serverless proxy + cache for Brreg's Enhetsregisteret (Central Coordinating
// Register for Legal Entities). Supports a direct org-number lookup and a
// name search, both normalized to a small stable shape so the client never
// has to deal with Brreg's raw HAL/_embedded structure or its schema changing.

const BASE_URL = "https://data.brreg.no/enhetsregisteret/api/enheter";
const UPSTREAM_TIMEOUT_MS = 8000;
const ORGNR_RE = /^\d{9}$/;
const MAX_SIZE = 20;
const DEFAULT_SIZE = 10;

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

function formatAddress(addr) {
  if (!addr) return null;
  const lines = Array.isArray(addr.adresse) ? addr.adresse.filter(Boolean) : [];
  return {
    lines,
    postalCode: addr.postnummer || null,
    city: addr.poststed || null,
    municipality: addr.kommune || null,
    country: addr.land || null,
  };
}

function normalizeEntity(e) {
  if (!e || typeof e !== "object" || !e.organisasjonsnummer) {
    throw new Error("Unexpected entity shape from Brreg");
  }
  return {
    orgNumber: e.organisasjonsnummer,
    name: e.navn || "(unnamed)",
    orgForm: e.organisasjonsform ? { code: e.organisasjonsform.kode, description: e.organisasjonsform.beskrivelse } : null,
    industry: e.naeringskode1 ? { code: e.naeringskode1.kode, description: e.naeringskode1.beskrivelse } : null,
    registeredDate: e.registreringsdatoEnhetsregisteret || null,
    vatRegistered: !!e.registrertIMvaregisteret,
    bankrupt: !!e.konkurs,
    winding: !!e.underAvvikling || !!e.underTvangsavviklingEllerTvangsopplosning,
    employees: typeof e.antallAnsatte === "number" ? e.antallAnsatte : null,
    website: e.hjemmeside || null,
    businessAddress: formatAddress(e.forretningsadresse),
    postalAddress: formatAddress(e.postadresse),
  };
}

module.exports = async function handler(req, res) {
  const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  if (isRateLimited(ip)) {
    res.setHeader("Retry-After", "30");
    return res.status(429).json({ success: false, error: "Too many requests. Please wait a moment and try again." });
  }

  const orgnr = typeof req.query?.orgnr === "string" ? req.query.orgnr.trim() : "";
  const q = typeof req.query?.q === "string" ? req.query.q.trim() : "";

  if (!orgnr && !q) {
    return res.status(400).json({ success: false, error: "Provide an organisation number (orgnr) or a name to search (q)." });
  }

  try {
    if (orgnr) {
      if (!ORGNR_RE.test(orgnr)) {
        return res.status(400).json({ success: false, error: "Organisation numbers are 9 digits." });
      }

      const upstream = await fetchWithTimeout(`${BASE_URL}/${orgnr}`, UPSTREAM_TIMEOUT_MS);

      if (upstream.status === 404) {
        return res.status(404).json({ success: false, error: "No entity found with that organisation number." });
      }
      if (!upstream.ok) {
        return res.status(502).json({ success: false, error: `Brreg returned an unexpected status (${upstream.status}).` });
      }

      const payload = await upstream.json();
      const entity = normalizeEntity(payload);

      res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=86400");
      return res.status(200).json({ success: true, mode: "lookup", entity });
    }

    if (q.length < 2) {
      return res.status(400).json({ success: false, error: "Type at least 2 characters to search." });
    }

    const page = clampInt(req.query?.page, 0, 0, 10000);
    const size = clampInt(req.query?.size, DEFAULT_SIZE, 1, MAX_SIZE);
    const url = `${BASE_URL}?navn=${encodeURIComponent(q)}&page=${page}&size=${size}`;

    const upstream = await fetchWithTimeout(url, UPSTREAM_TIMEOUT_MS);
    if (!upstream.ok) {
      return res.status(502).json({ success: false, error: `Brreg returned an unexpected status (${upstream.status}).` });
    }

    const payload = await upstream.json();
    const rawResults = (payload && payload._embedded && payload._embedded.enheter) || [];
    const results = rawResults.map(normalizeEntity);
    const pageInfo = payload && payload.page
      ? { number: payload.page.number, size: payload.page.size, totalElements: payload.page.totalElements, totalPages: payload.page.totalPages }
      : { number: page, size, totalElements: results.length, totalPages: results.length ? 1 : 0 };

    res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=86400");
    return res.status(200).json({ success: true, mode: "search", results, page: pageInfo });
  } catch (err) {
    const timedOut = err && err.name === "AbortError";
    if (timedOut) {
      return res.status(504).json({ success: false, error: "Brreg did not respond in time. Please try again shortly." });
    }
    if (err && /Unexpected entity shape/.test(err.message)) {
      return res.status(502).json({ success: false, error: "Brreg's data format has changed and could not be read.", detail: err.message });
    }
    return res.status(502).json({ success: false, error: "Could not reach Brreg." });
  }
};
