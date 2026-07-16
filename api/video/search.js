// Aurora Player — co-located video resolver (Vercel Serverless Function)
// Pure HTML scrape of YouTube search results (no yt-dlp / puppeteer needed).
// Returns the best-matching YouTube videoId to use as the audio source.
// Ported from the original Fly.dev backend so audio no longer depends on it.

const videoSearchCache = new Map(); // warm-instance cache

const readCache = (key) => {
  const c = videoSearchCache.get(key);
  if (!c) return null;
  if (c.expiresAt < Date.now()) { videoSearchCache.delete(key); return null; }
  return c.value;
};
const writeCache = (key, value, ttlMs = 1000 * 60 * 30) => {
  videoSearchCache.set(key, { value, expiresAt: Date.now() + ttlMs });
};

const videoQueriesFor = (artist, title) => {
  const base = `${artist} ${title}`.replace(/\s+/g, ' ').trim();
  const dash = `${artist} - ${title}`.replace(/\s+/g, ' ').trim();
  return [
    `${base} topic`,
    `${dash} topic`,
    `${artist} - topic ${title}`,
    `${base} vevo`,
    `${base} official audio`,
    `${dash} official audio`,
    `${base} audio`,
    `${base} visualizer`,
    `${base} official video`,
    base,
    dash,
  ];
};

// Unicode-aware: keep letters/numbers of ANY script (Greek, Cyrillic, …) and
// strip diacritics so accented/unaccented variants match. A latin-only
// [^a-z0-9] filter erased Greek titles entirely → wrong-song / no matches.
const cleanMatchText = (value) => value
  .toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, ' and ')
  .replace(/[^\p{L}\p{N} ]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const tokenize = (value) => cleanMatchText(value).split(' ').filter(Boolean);

const tokenCoverage = (target, candidate) => {
  const targetToks = tokenize(target);
  if (!targetToks.length) return 0;
  const candidateSet = new Set(tokenize(candidate));
  const hits = targetToks.filter((t) => candidateSet.has(t)).length;
  return hits / targetToks.length;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const extractVideoIds = (html) => [...new Set(
  [...html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)].map((m) => m[1]),
)];

const parseDurationText = (value) => {
  if (!value) return 0;
  const parts = value.trim().split(':').map((p) => Number(p));
  if (parts.some((p) => Number.isNaN(p))) return 0;
  return parts.reduce((total, p) => total * 60 + p, 0);
};

const HARD_REJECT = -99999;

const scoreVideoCandidate = (candidateTitle, candidateChannel, duration = 0, desiredDuration = 0, artist = '', track = '') => {
  const t = cleanMatchText(candidateTitle);
  const ch = cleanMatchText(candidateChannel);
  const trackTokens = tokenize(track);

  const significantTrackToks = trackTokens.filter((tok) => tok.length > 2);
  if (significantTrackToks.length > 0) {
    const titleSet = new Set(tokenize(candidateTitle));
    const trackHits = significantTrackToks.filter((tok) => titleSet.has(tok)).length;
    const trackCoverage = trackHits / significantTrackToks.length;
    if (trackCoverage < 0.85) return HARD_REJECT;
  }

  if (desiredDuration > 0 && duration > 0) {
    const diff = Math.abs(duration - desiredDuration);
    const ratio = diff / desiredDuration;
    if (desiredDuration < 120) { if (diff > 10) return HARD_REJECT; }
    else if (desiredDuration < 300) { if (diff > 5 && ratio > 0.03) return HARD_REJECT; }
    else { if (diff > 8 && ratio > 0.02) return HARD_REJECT; }
  }

  if (/\bkaraoke\b|\bnightcore\b|\breaction\b|\bpitch shift\b/.test(t)) return HARD_REJECT;

  let score = 0;
  const artistCov = tokenCoverage(artist, candidateTitle);
  const trackCov = tokenCoverage(track, candidateTitle);
  score += artistCov * 45;
  score += trackCov * 80;
  if (t.includes(cleanMatchText(track))) score += 35;
  if (t.includes(cleanMatchText(artist))) score += 20;
  if (/\btopic\b/.test(ch) || /\btopic\b/.test(t)) score += 50;
  if (/vevo$/.test(ch) || /\bvevo\b/.test(t)) score += 35;
  if (/\bofficial audio\b/.test(t)) score += 30;
  else if (/\bofficial\b/.test(t) && !/\bmusic video\b/.test(t)) score += 12;
  if (/\baudio\b/.test(t)) score += 18;
  if (/\bvisualizer\b/.test(t)) score += 10;
  if (/\blyrics?\b/.test(t)) score -= 12;
  if (/\bmusic video\b/.test(t)) score -= 5;
  if (/\blive\b|\bcover\b|\bsped up\b|\bslowed\b/.test(t)) score -= 50;
  if (/\btranslat/.test(t) || /\bremix\b/.test(t)) score -= 20;

  if (desiredDuration > 0 && duration > 0) {
    const diff = Math.abs(duration - desiredDuration);
    const ratio = diff / desiredDuration;
    if (diff <= 1 || ratio <= 0.01) score += 120;
    else if (diff <= 2 || ratio <= 0.02) score += 100;
    else if (diff <= 3 || ratio <= 0.03) score += 75;
    else if (diff <= 5 || ratio <= 0.05) score += 50;
    else if (diff <= 8 || ratio <= 0.08) score += 25;
    else score -= 30;
  } else if (desiredDuration > 0 && duration === 0) {
    score -= 20;
  }
  return score;
};

const toVideoConfidence = (score, candidateTitle, candidateChannel, artist, track, duration = 0, desiredDuration = 0) => {
  if (score === HARD_REJECT) return 0;
  let confidence = clamp(score / 300, 0, 1);
  const trackCov = tokenCoverage(track, candidateTitle);
  const artistCov = tokenCoverage(artist, candidateTitle);
  confidence = confidence * 0.30 + trackCov * 0.35 + artistCov * 0.15;
  if (desiredDuration > 0 && duration > 0) {
    const diff = Math.abs(duration - desiredDuration);
    const ratio = diff / desiredDuration;
    if (diff <= 1 || ratio <= 0.01) confidence += 0.25;
    else if (diff <= 2 || ratio <= 0.02) confidence += 0.20;
    else if (diff <= 3 || ratio <= 0.03) confidence += 0.15;
    else if (diff <= 5 || ratio <= 0.05) confidence += 0.10;
    else if (diff <= 8 || ratio <= 0.08) confidence += 0.05;
    else confidence -= 0.15;
  } else if (desiredDuration > 0 && duration === 0) {
    confidence -= 0.10;
  }
  const ch = cleanMatchText(candidateChannel);
  if (/\btopic\b/.test(ch)) confidence += 0.12;
  if (/vevo$/.test(ch)) confidence += 0.08;
  return clamp(confidence, 0, 1);
};

const extractTitleMap = (html) => {
  const map = new Map();
  for (const m of html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"[\s\S]{0,800}?"title":\{"runs":\[\{"text":"([^"]+)"/g)) {
    if (!map.has(m[1])) map.set(m[1], m[2]);
  }
  for (const m of html.matchAll(/"title":\{"runs":\[\{"text":"([^"]+)"[\s\S]{0,200}?"videoId":"([a-zA-Z0-9_-]{11})"/g)) {
    if (!map.has(m[2])) map.set(m[2], m[1]);
  }
  return map;
};

const extractDurationMap = (html) => {
  const map = new Map();
  for (const m of html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"[\s\S]{0,1200}?"lengthText":\{"simpleText":"([0-9:]+)"/g)) {
    if (!map.has(m[1])) map.set(m[1], parseDurationText(m[2]));
  }
  for (const m of html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"[\s\S]{0,1200}?"accessibilityData":\{"label":"([^"]*\d+ (?:minute|second)[^"]*)"/g)) {
    if (map.has(m[1])) continue;
    const label = m[2];
    const min = label.match(/(\d+) minute/)?.[1] ?? '0';
    const sec = label.match(/(\d+) second/)?.[1] ?? '0';
    map.set(m[1], Number(min) * 60 + Number(sec));
  }
  return map;
};

const extractChannelMap = (html) => {
  const map = new Map();
  for (const m of html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"[\s\S]{0,1500}?"ownerText":\{"runs":\[\{"text":"([^"]+)"/g)) {
    if (!map.has(m[1])) map.set(m[1], m[2]);
  }
  for (const m of html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"[\s\S]{0,1500}?"longBylineText":\{"runs":\[\{"text":"([^"]+)"/g)) {
    if (!map.has(m[1])) map.set(m[1], m[2]);
  }
  return map;
};

async function fetchYouTubeHtml(query, timeoutMs = 4500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!resp.ok) return '';
    return await resp.text();
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

// ─── InnerTube (YouTube's internal JSON API) ──────────────────────────────────
// The plain results-page HTML scrape gets served a consent/challenge page from
// datacenter IPs (e.g. Vercel), returning zero videos. InnerTube is the official
// internal API the site itself uses — far more reliable server-side — so it is
// the primary source, with the HTML scrape kept as a fallback.
const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8'; // public WEB client key
const INNERTUBE_CTX = { client: { clientName: 'WEB', clientVersion: '2.20240101.00.00', hl: 'en', gl: 'US' } };

async function innertubeSearch(query, timeoutMs = 4500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`https://www.youtube.com/youtubei/v1/search?key=${INNERTUBE_KEY}`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Origin': 'https://www.youtube.com',
      },
      body: JSON.stringify({ context: INNERTUBE_CTX, query }),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const out = [];
    const sections = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
      ?.sectionListRenderer?.contents || [];
    for (const s of sections) {
      const items = s?.itemSectionRenderer?.contents || [];
      for (const it of items) {
        const v = it.videoRenderer;
        if (!v?.videoId) continue;
        const vTitle = (v.title?.runs || []).map((r) => r.text).join('');
        const vChannel = v.ownerText?.runs?.[0]?.text || v.longBylineText?.runs?.[0]?.text || '';
        const vDur = parseDurationText(v.lengthText?.simpleText || '') || Number(v.lengthSeconds || 0) || 0;
        out.push({ videoId: v.videoId, title: vTitle, channel: vChannel, duration: vDur });
      }
    }
    return out;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function candidatesFromHtml(html) {
  const ids = extractVideoIds(html);
  if (!ids.length) return [];
  const titleMap = extractTitleMap(html);
  const durationMap = extractDurationMap(html);
  const channelMap = extractChannelMap(html);
  return ids.map((id) => ({
    videoId: id,
    title: titleMap.get(id) || '',
    channel: channelMap.get(id) || '',
    duration: durationMap.get(id) || 0,
  }));
}

async function collectCandidates(query) {
  const viaApi = await innertubeSearch(query);
  if (viaApi.length) return viaApi;
  const html = await fetchYouTubeHtml(query);
  return html ? candidatesFromHtml(html) : [];
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const artist = String(req.query.artist || '').trim();
  const title = String(req.query.title || '').trim();
  const desiredDuration = Number(req.query.duration || 0);
  const exclude = String(req.query.exclude || '').split(',').map((v) => v.trim()).filter(Boolean);

  if (!artist || !title) { res.status(400).json({ error: 'Missing artist or title' }); return; }

  const cacheKey = `${artist}::${title}::${desiredDuration || 0}::${exclude.join(',')}`;
  const cached = readCache(cacheKey);
  if (cached) { res.json(cached); return; }

  const seen = new Set(exclude);
  const queries = videoQueriesFor(artist, title);
  const allCandidates = [];
  let bestConfidenceSoFar = 0;
  const deadline = Date.now() + 9000; // stay under the default serverless timeout

  try {
    for (let qi = 0; qi < queries.length; qi++) {
      if (Date.now() > deadline) break;
      if (qi >= 3 && bestConfidenceSoFar >= 0.82) break;
      if (qi >= 6 && bestConfidenceSoFar >= 0.65) break;

      const candidates = await collectCandidates(queries[qi]);
      if (!candidates.length) continue;

      const ranked = candidates
        .filter((c) => c.videoId && !seen.has(c.videoId))
        .map((c) => {
          const vTitle = c.title || queries[qi];
          const vChannel = c.channel || '';
          const vDur = c.duration || 0;
          const sc = scoreVideoCandidate(vTitle, vChannel, vDur, desiredDuration, artist, title);
          const conf = sc === HARD_REJECT ? 0 : toVideoConfidence(sc, vTitle, vChannel, artist, title, vDur, desiredDuration);
          return { videoId: c.videoId, title: vTitle, channel: vChannel, duration: vDur, score: sc, confidence: conf, query: queries[qi] };
        })
        .filter((c) => c.score !== HARD_REJECT && c.confidence >= 0.18)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      allCandidates.push(...ranked);
      for (const c of ranked) if (c.confidence > bestConfidenceSoFar) bestConfidenceSoFar = c.confidence;
      // Fast path: a near-perfect match is good enough — stop early to keep
      // latency low and stay well under the serverless timeout.
      if (bestConfidenceSoFar >= 0.90) break;
    }

    const deduped = Array.from(
      allCandidates
        .sort((a, b) => b.score - a.score)
        .reduce((map, c) => {
          const existing = map.get(c.videoId);
          if (!existing || c.score > existing.score) map.set(c.videoId, c);
          return map;
        }, new Map())
        .values(),
    )
      .sort((a, b) => (b.confidence !== a.confidence ? b.confidence - a.confidence : b.score - a.score))
      .slice(0, 8);

    const best = deduped[0];
    if (best?.videoId) {
      const payload = {
        videoId: best.videoId,
        source: 'youtube-search',
        query: best.query,
        duration: best.duration || null,
        title: best.title,
        channel: best.channel,
        confidence: best.confidence,
        candidates: deduped,
      };
      if (best.confidence >= 0.50) writeCache(cacheKey, payload);
      else if (best.confidence >= 0.30) writeCache(cacheKey, payload, 1000 * 60 * 10);
      res.json(payload);
      return;
    }

    const payload = { videoId: null, source: 'youtube-search', query: queries[0], confidence: 0, candidates: [] };
    writeCache(cacheKey, payload, 1000 * 60 * 5);
    res.json(payload);
  } catch (err) {
    res.status(200).json({ videoId: null, source: 'youtube-search', error: String(err && err.message || err), confidence: 0, candidates: [] });
  }
}
