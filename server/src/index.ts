import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import { exec } from 'child_process';
import { promisify } from 'util';
import { scraper } from './scraper.js';
import { lyricsCache } from './cache.js';

const execAsync = promisify(exec);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const videoSearchCache = new Map<string, { value: any; expiresAt: number }>();

const readCache = (key: string) => {
  const cached = videoSearchCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt < Date.now()) {
    videoSearchCache.delete(key);
    return null;
  }
  return cached.value;
};

const writeCache = (key: string, value: any, ttlMs = 1000 * 60 * 30) => {
  videoSearchCache.set(key, { value, expiresAt: Date.now() + ttlMs });
};

// ─── Video Query Strategy ─────────────────────────────────────────────────────
// Ordered by reliability: Topic/VEVO channels first (auto-generated official),
// then official audio variants, then broader fallbacks.
const videoQueriesFor = (artist: string, title: string) => {
  const base = `${artist} ${title}`.replace(/\s+/g, ' ').trim();
  const dash = `${artist} - ${title}`.replace(/\s+/g, ' ').trim(); // YouTube standard format
  return [
    // Tier 1: YouTube Music auto-generated (most accurate title+duration)
    `${base} topic`,
    `${dash} topic`,
    `${artist} - topic ${title}`,
    // Tier 2: VEVO (official label channels)
    `${base} vevo`,
    // Tier 3: Official audio (no visuals, exact track)
    `${base} official audio`,
    `${dash} official audio`,
    // Tier 4: Other official formats
    `${base} audio`,
    `${base} visualizer`,
    `${base} official video`,
    // Tier 5: Broad fallbacks
    base,
    dash,
  ];
};

const cleanMatchText = (value: string) => value
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const tokenize = (value: string) => cleanMatchText(value).split(' ').filter(Boolean);

const tokenOverlap = (a: string, b: string) => {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));
  if (!aTokens.size || !bTokens.size) return 0;
  let hits = 0;
  for (const token of aTokens) if (bTokens.has(token)) hits++;
  return hits / Math.max(aTokens.size, bTokens.size);
};

// Coverage: what fraction of TARGET tokens appear in CANDIDATE
const tokenCoverage = (target: string, candidate: string): number => {
  const targetToks = tokenize(target);
  if (!targetToks.length) return 0;
  const candidateSet = new Set(tokenize(candidate));
  const hits = targetToks.filter(t => candidateSet.has(t)).length;
  return hits / targetToks.length;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const extractVideoIds = (html: string) => [...new Set(
  [...html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)].map((match) => match[1])
)];

const parseDurationText = (value: string) => {
  if (!value) return 0;
  const parts = value.trim().split(':').map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
};

// ─── IMPROVED: scoreVideoCandidate ───────────────────────────────────────────
// Hard gates prevent wrong-song matches regardless of other scores.
// Duration is weighted heavily when provided (from iTunes).
const HARD_REJECT = -99999;

const scoreVideoCandidate = (
  candidateTitle: string,
  candidateChannel: string,
  duration = 0,
  desiredDuration = 0,
  artist = '',
  track = '',
): number => {
  const t = cleanMatchText(candidateTitle);
  const ch = cleanMatchText(candidateChannel);

  const trackTokens = tokenize(track);
  const artistTokens = tokenize(artist);

  // ── HARD GATE 1: Track title must be substantially present ──────────────
  // Every significant track token must appear in the video title.
  const significantTrackToks = trackTokens.filter(tok => tok.length > 2);
  if (significantTrackToks.length > 0) {
    const titleSet = new Set(tokenize(candidateTitle));
    const trackHits = significantTrackToks.filter(tok => titleSet.has(tok)).length;
    const trackCoverage = trackHits / significantTrackToks.length;
    // VERY STRICT GATE: almost the exact match required
    if (trackCoverage < 0.85) return HARD_REJECT;
  }

  // ── SMART DURATION GATE: Adaptive tolerance based on song length ─────────
  if (desiredDuration > 0 && duration > 0) {
    const diff = Math.abs(duration - desiredDuration);
    const ratio = diff / desiredDuration;
    
    if (desiredDuration < 120) {
      // Short songs (< 2min): allow up to 10s difference
      if (diff > 10) return HARD_REJECT;
    } else if (desiredDuration < 300) {
      // Medium songs (2-5min): allow up to 5s or 3% variation
      if (diff > 5 && ratio > 0.03) return HARD_REJECT;
    } else {
      // Long songs (> 5min): allow up to 8s or 2% variation
      if (diff > 8 && ratio > 0.02) return HARD_REJECT;
    }
  }

  // ── HARD GATE 3: Reject known bad content types ──────────────────────────
  if (/\bkaraoke\b|\bnightcore\b|\breaction\b|\bpitch shift\b/.test(t)) return HARD_REJECT;

  // ── Base scoring ─────────────────────────────────────────────────────────
  let score = 0;

  const artistCov = tokenCoverage(artist, candidateTitle);
  const trackCov  = tokenCoverage(track, candidateTitle);

  score += artistCov * 45;
  score += trackCov  * 80;

  // Exact full-string containment bonus
  if (t.includes(cleanMatchText(track))) score += 35;
  if (t.includes(cleanMatchText(artist))) score += 20;

  // ── Channel type bonuses (Topic = auto-generated official YouTube Music) ──
  if (/\btopic\b/.test(ch) || /\btopic\b/.test(t)) score += 50;  // highest priority
  if (/vevo$/.test(ch) || /\bvevo\b/.test(t)) score += 35;       // official label
  if (/\bofficial audio\b/.test(t)) score += 30;
  else if (/\bofficial\b/.test(t) && !/\bmusic video\b/.test(t)) score += 12;
  if (/\baudio\b/.test(t)) score += 18;
  if (/\bvisualizer\b/.test(t)) score += 10;

  // ── Soft penalties ───────────────────────────────────────────────────────
  if (/\blyrics?\b/.test(t)) score -= 12;
  if (/\bmusic video\b/.test(t)) score -= 5;
  if (/\blive\b|\bcover\b|\bsped up\b|\bslowed\b/.test(t)) score -= 50;
  if (/\btranslat/.test(t) || /\bremix\b/.test(t)) score -= 20;

  // ── DURATION SCORING: Primary factor for exact match ─────────────────────
  if (desiredDuration > 0 && duration > 0) {
    const diff = Math.abs(duration - desiredDuration);
    const ratio = diff / desiredDuration;
    
    // Very precise match
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

// ─── IMPROVED: toVideoConfidence ─────────────────────────────────────────────
const toVideoConfidence = (
  score: number,
  candidateTitle: string,
  candidateChannel: string,
  artist: string,
  track: string,
  duration = 0,
  desiredDuration = 0,
): number => {
  if (score === HARD_REJECT) return 0;

  let confidence = clamp(score / 300, 0, 1);

  const trackCov   = tokenCoverage(track, candidateTitle);
  const artistCov  = tokenCoverage(artist, candidateTitle);

  // Duration-weighted confidence
  confidence = confidence * 0.30 + trackCov * 0.35 + artistCov * 0.15;

  // Duration match is critical
  if (desiredDuration > 0 && duration > 0) {
    const diff = Math.abs(duration - desiredDuration);
    const ratio = diff / desiredDuration;
    
    if (diff <= 1 || ratio <= 0.01)       confidence += 0.25;
    else if (diff <= 2 || ratio <= 0.02)    confidence += 0.20;
    else if (diff <= 3 || ratio <= 0.03)    confidence += 0.15;
    else if (diff <= 5 || ratio <= 0.05)    confidence += 0.10;
    else if (diff <= 8 || ratio <= 0.08)    confidence += 0.05;
    else                                   confidence -= 0.15;
  } else if (desiredDuration > 0 && duration === 0) {
    confidence -= 0.10;
  }

  // Channel type boosts
  const ch = cleanMatchText(candidateChannel);
  if (/\btopic\b/.test(ch)) confidence += 0.12;
  if (/vevo$/.test(ch))     confidence += 0.08;

  return clamp(confidence, 0, 1);
};

// ─── HTML extraction helpers ─────────────────────────────────────────────────
const extractTitleMap = (html: string): Map<string, string> => {
  const map = new Map<string, string>();
  // Pattern 1: videoId near title runs
  for (const m of html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"[\s\S]{0,800}?"title":\{"runs":\[\{"text":"([^"]+)"/g)) {
    if (!map.has(m[1])) map.set(m[1], m[2]);
  }
  // Pattern 2: title before videoId (alternate JSON ordering)
  for (const m of html.matchAll(/"title":\{"runs":\[\{"text":"([^"]+)"[\s\S]{0,200}?"videoId":"([a-zA-Z0-9_-]{11})"/g)) {
    if (!map.has(m[2])) map.set(m[2], m[1]);
  }
  return map;
};

const extractDurationMap = (html: string): Map<string, number> => {
  const map = new Map<string, number>();
  for (const m of html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"[\s\S]{0,1200}?"lengthText":\{"simpleText":"([0-9:]+)"/g)) {
    if (!map.has(m[1])) map.set(m[1], parseDurationText(m[2]));
  }
  // Also try accessibility label format: "3 minutes, 45 seconds"
  for (const m of html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"[\s\S]{0,1200}?"accessibilityData":\{"label":"([^"]*\d+ (?:minute|second)[^"]*)"/g)) {
    if (map.has(m[1])) continue;
    const label = m[2];
    const min = label.match(/(\d+) minute/)?.[1] ?? '0';
    const sec = label.match(/(\d+) second/)?.[1] ?? '0';
    map.set(m[1], Number(min) * 60 + Number(sec));
  }
  return map;
};

const extractChannelMap = (html: string): Map<string, string> => {
  const map = new Map<string, string>();
  // Channel name appears near videoId in JSON blob
  for (const m of html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"[\s\S]{0,1500}?"ownerText":\{"runs":\[\{"text":"([^"]+)"/g)) {
    if (!map.has(m[1])) map.set(m[1], m[2]);
  }
  for (const m of html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"[\s\S]{0,1500}?"longBylineText":\{"runs":\[\{"text":"([^"]+)"/g)) {
    if (!map.has(m[1])) map.set(m[1], m[2]);
  }
  return map;
};

// Allow CORS from Vite frontend
app.use(cors({ origin: '*' }));
app.use(express.json());

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'Aurora Backend Operational',
    version: '2.0.0',
    cache: { size: lyricsCache.size },
    timestamp: new Date().toISOString(),
  });
});

// ─── Search (Genius API → AJAX → LRCLib) with seamless fallbacks ─────────────
app.get('/api/genius/search', async (req: Request, res: Response) => {
  const query = req.query.q as string;
  if (!query) return res.status(400).json({ error: 'Missing query parameter' });

  try {
    const results = await scraper.search(query);
    // Return results even if empty — frontend handles empty state gracefully
    res.json(results);
  } catch (error: any) {
    // Log but don't fail — return empty array for seamless UX
    console.log(`[SEARCH] Error: ${error.message}`);
    res.json([]);
  }
});

// ─── IMPROVED: Video Search ────────────────────────────────────────────────────
// Key improvements:
//   1. Hard gates: wrong title/duration → immediate reject (HARD_REJECT score)
//   2. Channel extraction: Topic/VEVO channels get substantial bonus
//   3. Early exit: if confidence > 0.82 after first few queries, stop searching
//   4. Duration enforcement: ±1s = +100pts, >25s = HARD_REJECT
app.get('/api/video/search', async (req: Request, res: Response) => {
  const artist = String(req.query.artist || '').trim();
  const title  = String(req.query.title  || '').trim();
  const desiredDuration = Number(req.query.duration || 0);
  const exclude = String(req.query.exclude || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  if (!artist || !title) return res.status(400).json({ error: 'Missing artist or title' });

  const cacheKey = `${artist}::${title}::${desiredDuration || 0}::${exclude.join(',')}`;
  const cached = readCache(cacheKey);
  if (cached) return res.json(cached);

  const seen = new Set(exclude);
  const queries = videoQueriesFor(artist, title);

  type Candidate = {
    videoId: string;
    title: string;
    channel: string;
    duration: number;
    score: number;
    confidence: number;
    query: string;
  };

  const allCandidates: Candidate[] = [];
  // Track the global best so we can exit early
  let bestConfidenceSoFar = 0;

  try {
    for (let qi = 0; qi < queries.length; qi++) {
      const query = queries[qi];

      // ── Early exit: if we already have a very confident match, stop ──────
      // Tier-1 queries (Topic/VEVO) are first — if one of those returns a
      // great match quickly, no need to run 8 more queries.
      if (qi >= 3 && bestConfidenceSoFar >= 0.82) {
        console.log(`[VIDEO] Early exit at query ${qi} — confidence ${bestConfidenceSoFar.toFixed(2)}`);
        break;
      }
      // After tier-2 (6 queries), exit if reasonable confidence found
      if (qi >= 6 && bestConfidenceSoFar >= 0.65) {
        console.log(`[VIDEO] Early exit at query ${qi} — confidence ${bestConfidenceSoFar.toFixed(2)}`);
        break;
      }

      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
      let html = '';
      try {
        const page = await axios.get(searchUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          timeout: 10000,
        });
        html = typeof page.data === 'string' ? page.data : '';
      } catch {
        continue;
      }

      const ids         = extractVideoIds(html);
      if (ids.length === 0) continue;

      const titleMap    = extractTitleMap(html);
      const durationMap = extractDurationMap(html);
      const channelMap  = extractChannelMap(html);

      const ranked: Candidate[] = ids
        .filter((id) => !seen.has(id))
        .map((id) => {
          const vTitle   = titleMap.get(id) || query;
          const vChannel = channelMap.get(id) || '';
          const vDur     = durationMap.get(id) || 0;
          const sc       = scoreVideoCandidate(vTitle, vChannel, vDur, desiredDuration, artist, title);
          const conf     = sc === HARD_REJECT ? 0 : toVideoConfidence(sc, vTitle, vChannel, artist, title, vDur, desiredDuration);
          return { videoId: id, title: vTitle, channel: vChannel, duration: vDur, score: sc, confidence: conf, query };
        })
        .filter((c) => c.score !== HARD_REJECT && c.confidence >= 0.18)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      allCandidates.push(...ranked);

      // Update best confidence for early-exit logic
      for (const c of ranked) {
        if (c.confidence > bestConfidenceSoFar) bestConfidenceSoFar = c.confidence;
      }

      console.log(`[VIDEO] Query "${query}" → ${ranked.length} valid candidates (best conf: ${bestConfidenceSoFar.toFixed(2)})`);
    }

    // ── Deduplicate: keep highest-scoring entry per videoId ────────────────
    const deduped = Array.from(
      allCandidates
        .sort((a, b) => b.score - a.score)
        .reduce((map, c) => {
          const existing = map.get(c.videoId);
          if (!existing || c.score > existing.score) map.set(c.videoId, c);
          return map;
        }, new Map<string, Candidate>())
        .values(),
    )
      .sort((a, b) => {
        if (b.confidence !== a.confidence) return b.confidence - a.confidence;
        return b.score - a.score;
      })
      .slice(0, 8);

    const best = deduped[0];

    if (best?.videoId) {
      const payload = {
        videoId:    best.videoId,
        source:     'youtube-search',
        query:      best.query,
        duration:   best.duration || null,
        title:      best.title,
        channel:    best.channel,
        confidence: best.confidence,
        candidates: deduped,
      };

      // Cache good results; cache short-lived if confidence is marginal
      if (best.confidence >= 0.50) {
        writeCache(cacheKey, payload);                     // 30 min
      } else if (best.confidence >= 0.30) {
        writeCache(cacheKey, payload, 1000 * 60 * 10);    // 10 min
      }

      console.log(`[VIDEO] Best match: "${best.title}" (ch: "${best.channel}", conf: ${best.confidence.toFixed(2)}, dur: ${best.duration}s)`);
      return res.json(payload);
    }

    // No valid candidates found
    const payload = { videoId: null, source: 'youtube-search', query: queries[0], confidence: 0, candidates: [] };
    writeCache(cacheKey, payload, 1000 * 60 * 5);
    return res.json(payload);

  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Video search failed' });
  }
});

// ─── Structured Lyrics (4-Layer Scraper + Cache) ─────────────────────────────
app.get('/api/lyrics/structured', async (req: Request, res: Response) => {
  const artist = req.query.artist as string;
  const title  = req.query.title  as string;
  if (!artist || !title) return res.status(400).json({ error: 'Missing artist or title' });

  const cached = lyricsCache.get(artist, title);
  if (cached) {
    console.log(`[CACHE] HIT for "${artist} - ${title}"`);
    return res.json(cached);
  }

  const { lyrics, error } = await scraper.fetchLyrics(artist, title);
  if (!lyrics) {
    return res.status(404).json({ error: error || 'Lyrics not found' });
  }

  lyricsCache.set(artist, title, lyrics);
  console.log(`[CACHE] STORED "${artist} - ${title}" (source: ${lyrics.source})`);
  res.json(lyrics);
});

// ─── Legacy: Genius HTML Scraper (backward compat) ───────────────────────────
app.get('/api/genius/lyrics', async (req: Request, res: Response) => {
  const artist  = req.query.artist  as string;
  const title   = req.query.title   as string;
  const songUrl = req.query.url     as string;

  if (artist && title) {
    const cached = lyricsCache.get(artist, title);
    if (cached) {
      return res.json({
        lyrics: cached.rawText,
        sections: cached.sections.map(s => s.label),
        structured: cached.sections,
      });
    }
    const { lyrics } = await scraper.fetchLyrics(artist, title);
    if (lyrics) {
      lyricsCache.set(artist, title, lyrics);
      return res.json({
        lyrics: lyrics.rawText,
        sections: lyrics.sections.map(s => s.label),
        structured: lyrics.sections,
      });
    }
    return res.status(404).json({ error: 'Lyrics not found' });
  }

  if (!songUrl) return res.status(400).json({ error: 'Missing url or artist+title parameters' });

  try {
    const axiosLib  = (await import('axios')).default;
    const cheerio   = await import('cheerio');
    const pageRes   = await axiosLib.get(songUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      timeout: 8000,
    });
    const $           = cheerio.load(pageRes.data);
    const extractText = (el: any): string => {
      let result = '';
      $(el).contents().each((_: number, node: any) => {
        if (node.type === 'tag' && node.name === 'br') result += '\n';
        else if (node.type === 'text') result += $(node).text();
        else if (node.type === 'tag') result += extractText(node);
      });
      return result;
    };

    let fullText = '';
    $('[class^="Lyrics__Container"]').each((_: number, el: any) => { fullText += extractText(el) + '\n'; });

    let plainLyrics = fullText
      .replace(/\r/g, '').replace(/\n{3,}/g, '\n\n')
      .replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
      .trim();

    const firstHeaderIdx = plainLyrics.search(/^\[[A-Z][^\]]*\]/m);
    if (firstHeaderIdx > 0) plainLyrics = plainLyrics.substring(firstHeaderIdx).trim();

    const sections: string[] = [];
    for (const line of plainLyrics.split('\n')) {
      const m = line.trim().match(/^\[([^\]]+)\]$/);
      if (m) sections.push(m[1]);
    }

    const { parseSections } = await import('./scraper.js');
    const structured = parseSections(plainLyrics);
    res.json({ lyrics: plainLyrics, sections, structured });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to scrape lyrics' });
  }
});

// ─── Audio Stream via yt-dlp ──────────────────────────────────────────────────
// Selects the best available audio format (Opus WebM ≈160 kbps or AAC M4A ≈256 kbps),
// fetches the raw CDN URL server-side, caches it for 5 h, then proxies the byte
// stream (with Range support for seeking) back to the browser.
//
// Requirements: `yt-dlp` must be installed and on $PATH.
// Graceful degradation: if yt-dlp is absent the endpoint returns 503 so the
// frontend can fall back to the YouTube IFrame player.

// Cache: videoId → { url, contentType, expiresAt }
const audioUrlCache = new Map<string, { url: string; contentType: string; expiresAt: number }>();

// Probe yt-dlp availability once, then cache the result
let ytDlpAvailable: boolean | null = null;
async function checkYtDlp(): Promise<boolean> {
  if (ytDlpAvailable !== null) return ytDlpAvailable;
  try {
    await execAsync('yt-dlp --version', { timeout: 5000 });
    ytDlpAvailable = true;
    console.log('[AUDIO] yt-dlp detected ✓');
  } catch {
    ytDlpAvailable = false;
    console.log('[AUDIO] yt-dlp not found — /api/stream will return 503');
  }
  return ytDlpAvailable;
}

// Resolve the best direct audio URL for a YouTube video ID.
// Format priority: m4a (AAC 256 kbps from YT Music / VEVO) → webm (Opus ~160 kbps) → any best audio
async function resolveAudioUrl(videoId: string): Promise<{ url: string; contentType: string } | null> {
  const cached = audioUrlCache.get(videoId);
  if (cached && cached.expiresAt > Date.now()) return { url: cached.url, contentType: cached.contentType };

  const formatSelector = 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio';
  try {
    const { stdout } = await execAsync(
      `yt-dlp -f "${formatSelector}" --get-url "https://www.youtube.com/watch?v=${videoId}"`,
      { timeout: 25000 },
    );
    const url = stdout.trim().split('\n')[0];
    if (!url?.startsWith('http')) return null;

    // Detect format from URL query params (mime=audio%2Fmp4 → m4a, mime=audio%2Fwebm → webm)
    const lowerUrl = url.toLowerCase();
    const contentType =
      lowerUrl.includes('mime=audio%2fmp4') || lowerUrl.includes('.m4a')
        ? 'audio/mp4'
        : 'audio/webm';

    // Cache for 5 hours (YouTube CDN URLs expire after ~6 h)
    audioUrlCache.set(videoId, { url, contentType, expiresAt: Date.now() + 5 * 60 * 60 * 1000 });
    console.log(`[AUDIO] Resolved ${videoId} → ${contentType}`);
    return { url, contentType };
  } catch (err: any) {
    console.log(`[AUDIO] yt-dlp resolve failed for ${videoId}: ${err.message}`);
    return null;
  }
}

app.get('/api/stream', async (req: Request, res: Response) => {
  const videoId = req.query.v as string;

  // Validate videoId
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'Invalid or missing video ID' });
  }

  if (!(await checkYtDlp())) {
    return res.status(503).json({ error: 'yt-dlp not available — install it to enable high-quality streaming' });
  }

  const audioInfo = await resolveAudioUrl(videoId);
  if (!audioInfo) {
    // Clear stale cache entry if present
    audioUrlCache.delete(videoId);
    return res.status(502).json({ error: 'Failed to resolve audio URL' });
  }

  // Forward Range header so the browser can seek (partial content)
  const upstreamHeaders: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': '*/*',
  };
  if (req.headers.range) upstreamHeaders['Range'] = req.headers.range;

  try {
    const upstream = await axios.get(audioInfo.url, {
      responseType: 'stream',
      headers: upstreamHeaders,
      validateStatus: () => true, // forward non-200 status codes too
      timeout: 15000,
    });

    // Copy status + relevant headers
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers['content-type'] || audioInfo.contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-store'); // don't let Express cache partial responses
    if (upstream.headers['content-length']) res.setHeader('Content-Length', upstream.headers['content-length']);
    if (upstream.headers['content-range']) res.setHeader('Content-Range', upstream.headers['content-range']);

    // Pipe stream; abort upstream if client disconnects
    upstream.data.pipe(res);
    req.on('close', () => {
      try { upstream.data.destroy(); } catch { /* ignore */ }
    });
  } catch (err: any) {
    // URL may have expired — evict cache so next request re-resolves
    audioUrlCache.delete(videoId);
    if (!res.headersSent) res.status(502).json({ error: 'Stream proxy failed' });
  }
});

// ─── Audio URL check (HEAD endpoint for capability detection) ─────────────────
// The frontend calls this once after resolving a videoId to decide whether to
// use native <audio> streaming or fall back to the YouTube IFrame.
app.head('/api/stream', async (req: Request, res: Response) => {
  const videoId = req.query.v as string;
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return res.status(400).end();
  const available = await checkYtDlp();
  res.status(available ? 200 : 503).end();
});

import http from 'http';

const server = http.createServer(app);
server.listen(PORT, () => {
  console.log(`[AURORA] Backend v3.1 running on http://localhost:${PORT}`);
  console.log(`[AURORA] Video matching: Strict title+duration gates | Topic/VEVO priority | Early-exit enabled`);
  if (process.env.RAPIDAPI_KEY) {
    console.log(`[AURORA] RapidAPI Key: ✓ detected`);
  } else {
    console.log(`[AURORA] RapidAPI Key: ✗ missing`);
  }
  if (process.env.GENIUS_ACCESS_TOKEN) {
    console.log(`[AURORA] Genius API Token: ✓ detected`);
  } else {
    console.log(`[AURORA] Genius API Token: ✗ missing`);
  }
});