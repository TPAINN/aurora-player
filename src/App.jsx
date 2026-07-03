import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence, MotionConfig, LayoutGroup } from 'framer-motion';
import { Play, Pause, RotateCcw, Music2, Loader, Search, X, ArrowLeft, Eye, EyeOff, Film, History, Plus, Minus, Sparkles } from 'lucide-react';
import './App.css';
import { buildApiUrl } from './lib/api.js';
import { injectMotionTokens } from './lib/motionSystem.js';
import Particles from './components/Particles.jsx';
import BeatReactiveBackground from './components/BeatReactiveBackground.jsx';
import { useAudioAnalyzer } from './hooks/useAudioAnalyzer.js';
import {
  buildChorusRangesFromSections,
  detectChorusFromGeniusLyrics as detectChorusFromGenius,
  detectChorusRanges as detectChorus,
  fuseChorusRanges,
  weightChorusRangesByIntensity,
  findActiveLyricIndex as findActiveIdx,
  getLineEndTime,
  mapSectionsToLyricLinesDetailed,
} from './lib/lyrics.js';

void motion;

// ─── Performance tier detection — low / mid / high ───────────────────────────
const detectPerf = () => {
  if (window.__auroraPerfTier !== undefined) return window.__auroraPerfTier;
  const cores   = navigator.hardwareConcurrency || 2;
  const ram     = navigator.deviceMemory || 2;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let tier;
  if (reduced || cores <= 2 || ram <= 2)     tier = 'low';
  else if (cores <= 4 || ram <= 4)           tier = 'mid';
  else                                        tier = 'high';
  window.__auroraPerfTier = tier;
  document.documentElement.classList.toggle('perf-low', tier === 'low');
  document.documentElement.classList.toggle('perf-mid', tier === 'mid');
  return tier;
};
const PERF = detectPerf();
const ignoreError = (error) => {
  if (import.meta.env.DEV && error && error.name !== 'AbortError' && error.name !== 'TimeoutError') {
    console.warn('[aurora] swallowed error:', error);
  }
};

// ─── Initialize Motion System Tokens ───────────────────────────────────────────
injectMotionTokens();


// ─── Rich Sync Parser (word-level timestamps from LrcLib) ──────────────────────
const parseRichSync = (richSyncStr) => {
  try {
    const lines = JSON.parse(richSyncStr);
    const result = [];
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      const lineStart = line.t;
      const nextLineStart = lines[li + 1]?.t ?? (lineStart + 6);
      const rawWords = (line.l || []).filter(w => w.c && w.c.trim().length > 0);
      if (!rawWords.length) continue;
      const words = rawWords.map((w, wi) => {
        const wStart = lineStart + w.o;
        const wEnd = wi < rawWords.length - 1
          ? lineStart + rawWords[wi + 1].o
          : Math.min(nextLineStart - 0.05, lineStart + w.o + 0.8);
        return { text: w.c.trim(), start: wStart, end: Math.max(wStart + 0.05, wEnd) };
      }).filter(w => w.text.length > 0);
      if (!words.length) continue;
      result.push({ time: lineStart, text: words.map(w => w.text).join(' '), words, hasRichSync: true });
    }
    return result.length > 0 ? result : null;
  } catch { return null; }
};

// ─── LRC Parser ────────────────────────────────────────────────────────────────
// Parse [mm:ss.xx] timestamp to seconds
const parseTS = (mm, ss, cs) =>
  +mm * 60 + +ss + +cs / (cs.length === 3 ? 1000 : 100);

// Enhanced LRC parser — handles both:
//   [00:12.34]plain line text
//   [00:12.34]<00:12.34>Word <00:14.20>by <00:14.80>word
const parseLRC = (lrcString) => {
  const parsed = [];
  const lines = lrcString.split('\n');
  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li];
    // Match line timestamp
    const lm = raw.match(/^\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/);
    if (!lm) continue;
    const lineTime = parseTS(lm[1], lm[2], lm[3]);
    const rest = lm[4];

    // Check for Enhanced LRC inline word timestamps: <mm:ss.xx>word
    const enh = rest.match(/<(\d{2}):(\d{2})\.(\d{2,3})>/);
    if (enh) {
      // Parse all word tokens: <time>word
      const tokens = [];
      const re = /<(\d{2}):(\d{2})\.(\d{2,3})>([^<]*)/g;
      let m;
      while ((m = re.exec(rest)) !== null) {
        const ws = parseTS(m[1], m[2], m[3]);
        const word = m[4].trim();
        if (word) tokens.push({ text: word, start: ws, end: 0 });
      }
      if (tokens.length === 0) continue;
      // Compute end times: each word ends when next starts
      // Last word ends at next line start (or +2s fallback)
      const nextLineMatch = lines.slice(li + 1).find(l => /^\[\d{2}:\d{2}\./.test(l));
      const nextLineTime = nextLineMatch
        ? parseTS(...nextLineMatch.match(/^\[(\d{2}):(\d{2})\.(\d{2,3})\]/). slice(1))
        : lineTime + 4;
      for (let i = 0; i < tokens.length; i++) {
        tokens[i].end = i < tokens.length - 1
          ? tokens[i + 1].start - 0.01
          : Math.min(nextLineTime - 0.05, tokens[i].start + 1.2);
        tokens[i].end = Math.max(tokens[i].start + 0.05, tokens[i].end);
      }
      const text = tokens.map(t => t.text).join(' ');
      parsed.push({ time: lineTime, text, words: tokens, hasRichSync: true });
    } else {
      // Plain LRC — no word timestamps
      const text = rest.trim();
      if (text) parsed.push({ time: lineTime, text, words: null, hasRichSync: false });
    }
  }
  return parsed;
};

// Inject musical note indicators during meaningful long pauses only.
// Keeps the UI cleaner and avoids spamming the lyric rail between normal lines.
const injectGaps = (lyrs) => {
  if (!lyrs || lyrs.length === 0) return lyrs;
  const res = [];
  for (let i = 0; i < lyrs.length; i++) {
    res.push(lyrs[i]);
    if (i < lyrs.length - 1) {
      const cur = lyrs[i], nxt = lyrs[i+1];
      let curEnd = cur.time + 3;
      if (cur.words && cur.words.length) {
        curEnd = cur.words[cur.words.length - 1].end;
      }
      const gap = nxt.time - curEnd;
      if (gap > 4.5) {
        const noteText = gap > 13 ? '♪ ♪ ♪' : gap > 8.5 ? '♪ ♪' : '♪';
        res.push({
          time: curEnd + Math.min(2.4, gap * 0.45),
          text: noteText,
          words: null,
          hasRichSync: false,
          isGap: true,
        });
      }
    }
  }
  return res;
};

// Count how many lines have word-level data
const countRichLines = (lyrics) => lyrics.filter(l => l.words).length;

const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const _cleanStr = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const normalizeArtistName = (value = '') => _cleanStr(value)
  .replace(/\b(the|dj|mc)\b/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const normalizeTrackTitle = (value = '') => _cleanStr(value)
  .replace(/\b(feat|ft|featuring)\b.*$/g, ' ')
  .replace(/\b(remaster(?:ed)?|live|version|edit|mono|stereo|explicit|clean|official|video|audio|visualizer|lyrics?)\b/g, ' ')
  .replace(/\b(extended|radio mix|original mix|album version|single version)\b/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const SEARCH_NOISE_RE = /\b(turkce ceviri|turkish translation|translation|translated|ceviri|çeviri|romanized|karaoke|nightcore|slowed|reverb|sped up|cover|tribute|parody|lyrics?|lyric video|official video|audio|visualizer)\b/i;

const tokenize = (value = '') => normalizeTrackTitle(value).split(' ').filter(Boolean);
const weightedLyricLength = (value = '') => [...(value || '')].reduce((sum, ch) => {
  if (/\s/.test(ch)) return sum + 0.34;
  if (/[MW@#%&QGOD]/.test(ch)) return sum + 1.32;
  if (/[il'`,.:;]/.test(ch)) return sum + 0.52;
  if (/[A-Z]/.test(ch)) return sum + 1.08;
  return sum + 0.92;
}, 0);

const getLyricLenBucket = (value = '') => {
  const len = weightedLyricLength(value);
  if (len > 88) return 'xxl';
  if (len > 74) return 'xl';
  if (len > 60) return 'lg';
  if (len > 46) return 'md';
  return undefined;
};

const getLyricFitMultiplier = (value = '', isActive = false, isGap = false) => {
  if (isGap) return 1;
  const len = weightedLyricLength(value);
  if (isActive) {
    if (len > 100) return 0.58;
    if (len > 90) return 0.64;
    if (len > 80) return 0.72;
    if (len > 70) return 0.8;
    if (len > 60) return 0.88;
    if (len > 52) return 0.94;
    return 1;
  }
  if (len > 92) return 0.74;
  if (len > 80) return 0.8;
  if (len > 68) return 0.87;
  if (len > 54) return 0.94;
  return 1;
};

const tokenOverlap = (a, b) => {
  const aSet = new Set(tokenize(a));
  const bSet = new Set(tokenize(b));
  if (!aSet.size || !bSet.size) return 0;
  let hits = 0;
  for (const token of aSet) if (bSet.has(token)) hits++;
  return hits / Math.max(aSet.size, bSet.size);
};

const scoreTrackMatch = (candidate, artist, track, duration = 0) => {
  const candidateArtist = normalizeArtistName(candidate.artistName || candidate.artist || '');
  const candidateTrack = normalizeTrackTitle(candidate.trackName || candidate.trackCensoredName || candidate.title || '');
  const targetArtist = normalizeArtistName(artist);
  const targetTrack = normalizeTrackTitle(track);

  let score = 0;
  if (candidateArtist === targetArtist) score += 55;
  else if (candidateArtist.includes(targetArtist) || targetArtist.includes(candidateArtist)) score += 28;
  score += tokenOverlap(candidateTrack, targetTrack) * 50;

  if (candidateTrack === targetTrack) score += 35;
  else if (candidateTrack.includes(targetTrack) || targetTrack.includes(candidateTrack)) score += 18;

  // Better duration matching with ratio-based scoring
  const candidateDuration = candidate.duration || candidate.trackTimeMillis / 1000 || 0;
  if (duration > 0 && candidateDuration > 0) {
    const diff = Math.abs(candidateDuration - duration);
    const ratio = diff / duration;
    
    // Very precise match
    if (diff < 1.2 || ratio < 0.02) score += 35;
    // Good match
    else if (diff < 2.5 || ratio < 0.03) score += 28;
    // Acceptable match
    else if (diff < 4.0 || ratio < 0.05) score += 20;
    // Fair match
    else if (diff < 7.0 || ratio < 0.08) score += 12;
    // Minor penalty for short deviations
    else if (diff < 12.0 || ratio < 0.12) score += 4;
    // Large deviation penalty
    else if (diff > 18.0) score -= 20;
  }

  return score;
};

const scoreSuggestionCandidate = (candidate, query) => {
  const candidateArtist = candidate.artistName || candidate.artist || '';
  const candidateTrack = candidate.trackName || candidate.title || '';
  const candidateAlbum = candidate.albumName || '';
  const queryClean = _cleanStr(query);
  const combined = `${candidateArtist} ${candidateTrack}`.trim();
  const reversed = `${candidateTrack} ${candidateArtist}`.trim();

  let score = 0;

  score += tokenOverlap(combined, query) * 90;
  score += tokenOverlap(candidateTrack, query) * 60;
  score += tokenOverlap(candidateArtist, query) * 50;

  const combinedClean = _cleanStr(combined);
  const reversedClean = _cleanStr(reversed);
  const artistClean = _cleanStr(candidateArtist);
  const trackClean = _cleanStr(candidateTrack);

  if (combinedClean === queryClean || reversedClean === queryClean) score += 75;
  else {
    if (trackClean && queryClean.includes(trackClean)) score += 34;
    if (artistClean && queryClean.includes(artistClean)) score += 30;
  }

  if (candidate.hasSynced) score += 10;
  if (candidate.art) score += 8;
  if ((candidate.duration || 0) > 30) score += 8;
  else if ((candidate.duration || 0) === 0) score -= candidate.source === 'itunes' ? 16 : 42;

  if (candidate.source === 'itunes') score += 18;
  else if (candidate.source === 'genius') score -= 4;

  const noisy = SEARCH_NOISE_RE.test(candidateTrack) || SEARCH_NOISE_RE.test(candidateArtist) || SEARCH_NOISE_RE.test(candidateAlbum);
  if (noisy && !SEARCH_NOISE_RE.test(query)) score -= 72;

  if (artistClean && trackClean && queryClean.includes(artistClean) && queryClean.includes(trackClean)) {
    score += 24;
  }

  return score;
};

const dedupeTracks = (tracks) => {
  const seen = new Set();
  return tracks.filter((track) => {
    const key = `${normalizeArtistName(track.artistName)}|${normalizeTrackTitle(track.trackName)}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const upgradeArtworkUrl = (url, size = 'full') => {
  if (!url) return null;
  if (url.includes('mzstatic.com')) {
    const target = size === 'thumb' ? '120x120bb' : size === 'preview' ? '320x320bb' : '1400x1400bb';
    return url.replace(/\d+x\d+bb/g, target);
  }
  if (url.includes('genius.com') || url.includes('geniususercontent.com') || url.includes('images.genius.com')) {
    const target = size === 'thumb' ? '120x120x1' : size === 'preview' ? '400x400x1' : '1000x1000x1';
    return url.replace(/\.\d+x\d+x1(?=\.)/g, `.${target}`);
  }
  return url;
};

const mapItunesTrack = (hit) => ({
  id: hit.trackId || hit.collectionId || `${hit.artistName}-${hit.trackName}`,
  trackName: hit.trackName,
  artistName: hit.artistName,
  albumName: hit.collectionName || '',
  duration: hit.trackTimeMillis ? hit.trackTimeMillis / 1000 : 0,
  art: hit.artworkUrl100 ? upgradeArtworkUrl(hit.artworkUrl100, 'full') : null,
  genre: hit.primaryGenreName || '',
  previewUrl: hit.previewUrl || null,
  hasSynced: true,
  source: 'itunes',
});

const _artScore = (hit, artist, track) => {
  const ha = _cleanStr(hit.artistName || '');
  const ht = _cleanStr(hit.trackName  || '');
  const a  = _cleanStr(artist), t = _cleanStr(track);
  let score = 0;
  if (ha === a) score += 40; else if (ha.includes(a) || a.includes(ha)) score += 20;
  if (ht === t) score += 40; else if (ht.includes(t) || t.includes(ht)) score += 20;
  return score;
};

const fetchTrackMeta = async (artist, track) => {
  // Try progressively broader queries until we get a good match
  const queries = [
    `${artist} ${track}`,
    track,
    `${artist} ${track}`.replace(/[^\w\s]/g, ''),
  ];
  for (const q of queries) {
    try {
      const res = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&limit=8&entity=song`,
        { signal: AbortSignal.timeout(6000) }
      );
      if (!res.ok) continue;
      const data = await res.json();
      if (!data.results?.length) continue;
      // Score each hit and pick the best
      const scored = data.results
        .filter(h => h.artworkUrl100)
        .map(h => ({ h, s: _artScore(h, artist, track) }))
        .sort((a, b) => b.s - a.s);
      if (scored.length && scored[0].s >= 20) {
        return upgradeArtworkUrl(scored[0].h.artworkUrl100, 'full');
      }
      // If no great match, use first result anyway
      if (data.results[0]?.artworkUrl100) {
        return upgradeArtworkUrl(data.results[0].artworkUrl100, 'full');
      }
    } catch { /* try next query */ }
  }
  return null;
};

const resolveCanonicalTrack = async (track) => {
  const queries = [
    `${track.artistName} ${track.trackName}`,
    `${track.trackName} ${track.artistName}`,
    track.trackName,
  ];

  for (const q of queries) {
    try {
      const res = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&limit=10&entity=song`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (!res.ok) continue;
      const data = await res.json();
      if (!Array.isArray(data.results) || data.results.length === 0) continue;
      const scored = data.results
        .map((item) => ({ item, score: scoreTrackMatch(item, track.artistName, track.trackName, track.duration || 0) }))
        .sort((a, b) => b.score - a.score);
      const best = scored[0];
      if (!best || best.score < 48) continue;
      return {
        artistName: best.item.artistName,
        trackName: best.item.trackName,
        albumName: best.item.collectionName || track.albumName || '',
        duration: best.item.trackTimeMillis ? best.item.trackTimeMillis / 1000 : track.duration || 0,
        art: best.item.artworkUrl100 ? upgradeArtworkUrl(best.item.artworkUrl100, 'full') : upgradeArtworkUrl(track.art, 'full'),
        genre: best.item.primaryGenreName || track.genre || '',
      };
    } catch (error) {
      ignoreError(error);
    }
  }

  return null;
};

const buildSuggestionQueries = (query) => {
  const cleaned = query.trim();
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  const queries = [cleaned];

  if (tokens.length >= 2) {
    queries.push(tokens.slice().reverse().join(' '));
    queries.push(tokens.join('+'));
  }

  return [...new Set(queries.filter(Boolean))].slice(0, 3);
};

// ── Tiny localStorage cache (7-day TTL) — repeat plays skip the network ──
const CACHE_TTL = 7 * 24 * 3600 * 1000;
const cacheKey = (ns, artist, track) => `aurora:${ns}:${(artist || '').toLowerCase()}|${(track || '').toLowerCase()}`;
const cacheGet = (ns, artist, track) => {
  try {
    const raw = localStorage.getItem(cacheKey(ns, artist, track));
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (Date.now() - entry.ts > CACHE_TTL) return null;
    return entry.v;
  } catch { return null; }
};
const cacheSet = (ns, artist, track, v) => {
  try { localStorage.setItem(cacheKey(ns, artist, track), JSON.stringify({ v, ts: Date.now() })); } catch { /* quota */ }
};

const fetchVideoId = async (artist, track, excludeIds = [], duration = 0) => {
  if (!excludeIds.length) {
    const cached = cacheGet('vid', artist, track);
    if (cached) return cached;
  }
  try {
    // iTunes artist strings bundle every featured artist ("Daft Punk, Pharrell
    // Williams & Nile Rodgers") which skews YouTube matching toward the
    // featured artist's own hits — search with the primary artist only.
    const primaryArtist = artist.split(/,|&|\bfeat\.?\b|\bft\.?\b|\bwith\b/i)[0].trim() || artist;
    const res = await fetch(buildApiUrl('/api/video/search', {
      artist: primaryArtist,
      title: track,
      duration: duration > 0 ? duration.toFixed(2) : undefined,
      exclude: excludeIds.join(','),
    }), { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return null;
    const data = await res.json();
    const videoId = data?.videoId || null;
    if (videoId && !excludeIds.length) cacheSet('vid', artist, track, videoId);
    return videoId;
  } catch (error) {
    ignoreError(error);
    return null;
  }
};

const extractColors = (url) => new Promise(resolve => {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  const bail = setTimeout(() => resolve(null), 5000);
  img.onerror = () => { clearTimeout(bail); resolve(null); };
  img.onload = () => {
    clearTimeout(bail);
    try {
      // Use 100x100 for better sampling fidelity
      const S = 100, cv = document.createElement('canvas');
      cv.width = cv.height = S;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0, S, S);
      const { data } = ctx.getImageData(0, 0, S, S);
      const buckets = {};
      let totalWeight = 0;
      let satWeight = 0;
      let avgR = 0, avgG = 0, avgB = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const l = (max + min) / 510;
        if (l < 0.04 || l > 0.96) continue;       // skip near-black / near-white
        const d = max - min;
        const s = max === 0 ? 0 : d / (255 * (1 - Math.abs(2 * l - 1)));
        // Weight by saturation and mid-lightness (avoid washed-out colours)
        const midness = 1 - Math.abs(2 * l - 1);
        const baseW = Math.max(0.08, Math.pow(Math.max(s, 0.02), 1.2)) * Math.max(midness, 0.18);
        totalWeight += baseW;
        satWeight += s * baseW;
        avgR += r * baseW;
        avgG += g * baseW;
        avgB += b * baseW;
        if (s < 0.12) continue;                     // skip near-grey for hue buckets
        const w = baseW;
        let h;
        if (max === r) h = ((g - b) / d + 6) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h = (h * 60 + 360) % 360;
        const bucket = Math.round(h / 12) * 12 % 360; // 12° buckets — finer
        if (!buckets[bucket]) buckets[bucket] = { w: 0, r: 0, g: 0, b: 0 };
        buckets[bucket].w += w;
        buckets[bucket].r += r * w;
        buckets[bucket].g += g * w;
        buckets[bucket].b += b * w;
      }
      const avgSat = totalWeight > 0 ? satWeight / totalWeight : 0;
      const neutralBase = totalWeight > 0
        ? [
            Math.round(avgR / totalWeight),
            Math.round(avgG / totalWeight),
            Math.round(avgB / totalWeight),
          ]
        : null;
      if (avgSat < 0.16 && neutralBase) {
        const [h, s, l] = _rgbToHsl(...neutralBase);
        const mkNeutral = (lightness, satBoost = 0.05) =>
          _hslToRgb(h, Math.min(0.12, s + satBoost), lightness).join(',');
        resolve([
          mkNeutral(Math.min(0.38, Math.max(0.16, l * 0.80))),
          mkNeutral(Math.min(0.48, Math.max(0.22, l * 0.96)), 0.03),
          mkNeutral(Math.min(0.62, Math.max(0.28, l * 1.12)), 0.02),
        ]);
        return;
      }
      const sorted = Object.entries(buckets).sort((a, b) => b[1].w - a[1].w);
      const picked = [];
      for (const [hStr] of sorted) {
        const h = +hStr;
        // 45° minimum angular distance for richer palette variety
        if (picked.some(p => Math.min(Math.abs(p - h), 360 - Math.abs(p - h)) < 45)) continue;
        picked.push(h);
        if (picked.length === 3) break;
      }
      if (picked.length === 0) { resolve(null); return; }
      while (picked.length < 3) picked.push(picked[picked.length - 1] ?? picked[0]);
      const colors = picked.map(h => {
        const bk = buckets[h] || buckets[Math.round(h / 12) * 12 % 360];
        if (!bk || bk.w === 0) {
          const [pr, pg, pb] = _hslToRgb(h / 360, 0.38, 0.48);
          return `${pr},${pg},${pb}`;
        }
        return `${Math.round(bk.r / bk.w)},${Math.round(bk.g / bk.w)},${Math.round(bk.b / bk.w)}`;
      });
      resolve(colors);
    } catch { resolve(null); }
  };
  img.src = url;
});

// ─── HSL helpers — Material You tonal palette derivation ─────────────────────
const _rgbToHsl = (r, g, b) => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
};
const _hslToRgb = (h, s, l) => {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  return [Math.round(ch(h + 1/3) * 255), Math.round(ch(h) * 255), Math.round(ch(h - 1/3) * 255)];
};

// ─── Material You tonal palette — faithful to album, smooth transitions ─────
const DEFAULT_PALETTE = {
  c:    ['167,139,250', '244,114,182', '103,232,249'],
  glow: ['185,155,255', '255,125,195', '115,242,255'],
  dim:  '55,42,90',
  bg:   '6,7,14',
};

let _colorRaf = null;
const applyColors = (colors, instant = false) => {
  if (_colorRaf) cancelAnimationFrame(_colorRaf);
  const run = () => {
    _colorRaf = null;
    const root = document.documentElement;
    if (!colors) {
      root.style.setProperty('--c1', DEFAULT_PALETTE.c[0]);
      root.style.setProperty('--c2', DEFAULT_PALETTE.c[1]);
      root.style.setProperty('--c3', DEFAULT_PALETTE.c[2]);
      root.style.setProperty('--c1-glow', DEFAULT_PALETTE.glow[0]);
      root.style.setProperty('--c2-glow', DEFAULT_PALETTE.glow[1]);
      root.style.setProperty('--c3-glow', DEFAULT_PALETTE.glow[2]);
      root.style.setProperty('--c1-dim', DEFAULT_PALETTE.dim);
      root.style.setProperty('--bg-rgb', DEFAULT_PALETTE.bg);
      return;
    }
    const c = colors;
    root.style.setProperty('--c1', c[0]);
    root.style.setProperty('--c2', c[1] || c[0]);
    root.style.setProperty('--c3', c[2] || c[0]);

    const parse = str => str.split(',').map(Number);
    const slots = [c[0], c[1] || c[0], c[2] || c[0]];
    const hsls  = slots.map(s => _rgbToHsl(...parse(s)));

    // Vivid glow: stay faithful to album hue, stronger sat/light push for more pop
    const vivid = ([h, s, l]) => {
      const guardedL = Math.max(0.38, Math.min(0.62, l * 0.92 + 0.06));
      return _hslToRgb(h,
        Math.min(Math.max(s * 1.05 + 0.04, 0.42), 0.82),
        guardedL);
    };

    const dim = ([h, s, l]) =>
      _hslToRgb(h, s * 0.55, Math.max(l * 0.30, 0.07));

    const [g1, g2, g3] = hsls.map(vivid).map(r => r.join(','));
    const [d1]         = hsls.map(dim).map(r => r.join(','));

    root.style.setProperty('--c1-glow', g1);
    root.style.setProperty('--c2-glow', g2);
    root.style.setProperty('--c3-glow', g3);
    root.style.setProperty('--c1-dim', d1);

    // Background tint — slightly more saturated for richer feel
    const [h0, s0] = hsls[0];
    const [sr, sg, sb] = _hslToRgb(h0, Math.min(s0 * 0.18, 0.10), 0.046);
    root.style.setProperty('--bg-rgb', `${sr},${sg},${sb}`);
  };
  if (instant) run();
  else _colorRaf = requestAnimationFrame(run);
};

const distClass = (dist, isActive) => {
  if (isActive) return 'la';
  if (dist === 1) return 'l1';
  if (dist === 2) return 'l2';
  if (dist === 3) return 'l3';
  if (dist === 4) return 'l4';
  if (dist <= 6) return 'l5';
  return 'lf';
};


// ─── Genius-powered chorus detection from section headers ─────────────────────
// Matches Genius [Chorus] / [Refrain] / [Hook] / [Pre-Chorus] headers

// Construct a Genius URL from artist + title:
// Pattern: https://genius.com/{Artist}-{Title}-lyrics
// e.g. "The Weeknd" + "Starboy" -> "https://genius.com/The-weeknd-starboy-lyrics"
// e.g. "Lumine (EDM)" + "Don't Worry" -> "https://genius.com/Lumine-edm-dont-worry-lyrics"
const buildGeniusUrl = (artist, title) => {
  let cleanTitle = title
    .replace(/\s*\((?:feat|ft|prod|official|music|lyric|audio|video|remix)\.?[^)]*\)/gi, '')
    .replace(/\s*\[(?:feat|ft|prod|official|music|lyric|audio|video|remix)\.?[^\]]*\]/gi, '')
    .trim();
  let cleanArtist = artist
    .replace(/\s*\(([^)]+)\)/g, ' $1')
    .trim();
  const slug = `${cleanArtist} ${cleanTitle}`
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/['']/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `https://genius.com/${slug}-lyrics`;
};

// ─── Song energy estimator (0 = slow ballad, 1 = fast/energetic) ──────────────
// Uses lyric density (words/sec) and gap ratio to estimate tempo feel.
// High density + short gaps = energetic → fast chorus transitions.
const estimateSongEnergy = (lyrics) => {
  if (!lyrics || lyrics.length < 4) return 0.5;
  let totalWords = 0, shortGaps = 0, totalGaps = 0;
  for (let i = 0; i < lyrics.length; i++) {
    totalWords += lyrics[i].text.split(/\s+/).filter(w => w).length;
    if (i > 0) {
      const gap = lyrics[i].time - lyrics[i - 1].time;
      totalGaps++;
      if (gap < 2.5) shortGaps++;
    }
  }
  const totalDur = Math.max(lyrics[lyrics.length - 1].time - lyrics[0].time, 30);
  const wps = totalWords / totalDur;
  const gapDensity = shortGaps / Math.max(totalGaps, 1);
  // Blend word density + gap density → 0-1 energy score
  const raw = Math.min(1, wps * 3.0) * 0.6 + gapDensity * 0.4;
  return Math.min(1, Math.max(0, raw));
};

// ─── Map structured sections to synced lyric line indices ───────────────────
// Takes StructuredLyrics sections[] and synced lyric lines, produces a
// per-line sectionType array for O(1) lookup during playback.
const _mapSectionsToLyrics = (syncedLyrics, structuredSections) => {
  if (!structuredSections?.length || !syncedLyrics?.length) return [];
  const norm = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

  // Build a flat list: { text, sectionType } for each line in structured sections
  const sectionLines = [];
  for (const sec of structuredSections) {
    for (const line of sec.content) {
      sectionLines.push({ text: norm(line), type: sec.type || 'unknown' });
    }
  }

  // For each synced lyric line, find the best matching section line
  const map = new Array(syncedLyrics.length).fill('verse'); // default to verse
  let sPtr = 0; // pointer into sectionLines for sequential matching

  for (let li = 0; li < syncedLyrics.length; li++) {
    const lText = norm(syncedLyrics[li].text);
    if (!lText || lText.length < 3 || syncedLyrics[li].isGap) continue;

    // Try sequential match first (most common — lyrics are in order)
    if (sPtr < sectionLines.length) {
      const sText = sectionLines[sPtr].text;
      if (lText === sText || lText.includes(sText) || sText.includes(lText)) {
        map[li] = sectionLines[sPtr].type;
        sPtr++;
        continue;
      }
      // Fuzzy match at current pointer
      const wa = lText.split(' ').filter(w => w.length > 2);
      const wb = sText.split(' ').filter(w => w.length > 2);
      if (wa.length && wb.length) {
        let inter = 0;
        for (const w of wa) if (wb.includes(w)) inter++;
        if (inter / Math.max(wa.length, wb.length) >= 0.55) {
          map[li] = sectionLines[sPtr].type;
          sPtr++;
          continue;
        }
      }
    }

    // Scan ahead in section lines (handle skipped instrumental lines)
    let found = false;
    for (let scan = sPtr; scan < Math.min(sPtr + 6, sectionLines.length); scan++) {
      const sText = sectionLines[scan].text;
      if (lText === sText || lText.includes(sText) || sText.includes(lText)) {
        map[li] = sectionLines[scan].type;
        sPtr = scan + 1;
        found = true;
        break;
      }
      const wa = lText.split(' ').filter(w => w.length > 2);
      const wb = sText.split(' ').filter(w => w.length > 2);
      if (wa.length && wb.length) {
        let inter = 0;
        for (const w of wa) if (wb.includes(w)) inter++;
        if (inter / Math.max(wa.length, wb.length) >= 0.55) {
          map[li] = sectionLines[scan].type;
          sPtr = scan + 1;
          found = true;
          break;
        }
      }
    }

    // If still no match, inherit from previous line
    if (!found && li > 0) {
      map[li] = map[li - 1];
    }
  }

  return map;
};

// ─── Section transition CSS config ──────────────────────────────────────────
// Each section type has its own transition duration and intensity level
const SECTION_TRANSITIONS = {
  'verse':        { inDur: '2.0s',  outDur: '1.5s',  cssClass: 'section-verse' },
  'pre-chorus':   { inDur: '1.0s',  outDur: '0.6s',  cssClass: 'section-pre-chorus' },
  'chorus':       { inDur: '0.5s',  outDur: '0.8s',  cssClass: 'section-chorus' },
  'hook':         { inDur: '0.5s',  outDur: '0.8s',  cssClass: 'section-chorus' },
  'refrain':      { inDur: '0.5s',  outDur: '0.8s',  cssClass: 'section-chorus' },
  'bridge':       { inDur: '4.0s',  outDur: '2.5s',  cssClass: 'section-bridge' },
  'intro':        { inDur: '3.0s',  outDur: '1.5s',  cssClass: 'section-intro' },
  'outro':        { inDur: '3.5s',  outDur: '2.0s',  cssClass: 'section-outro' },
  'interlude':    { inDur: '3.0s',  outDur: '2.0s',  cssClass: 'section-bridge' },
  'post-chorus':  { inDur: '1.2s',  outDur: '0.8s',  cssClass: 'section-post-chorus' },
  'unknown':      { inDur: '2.0s',  outDur: '1.5s',  cssClass: 'section-verse' },
  'none':         { inDur: '2.0s',  outDur: '1.5s',  cssClass: '' },
};

const SECTION_VISUAL_INTENSITY = {
  'none': { lift: 0.06, bloom: 0.04 },
  'intro': { lift: 0.08, bloom: 0.05 },
  'verse': { lift: 0.12, bloom: 0.08 },
  'pre-chorus': { lift: 0.34, bloom: 0.18 },
  'chorus': { lift: 0.52, bloom: 0.3 },
  'hook': { lift: 0.52, bloom: 0.3 },
  'refrain': { lift: 0.46, bloom: 0.24 },
  'post-chorus': { lift: 0.26, bloom: 0.14 },
  'bridge': { lift: 0.16, bloom: 0.06 },
  'interlude': { lift: 0.1, bloom: 0.04 },
  'outro': { lift: 0.08, bloom: 0.03 },
};

const makeScroller = () => {
  // Ultra-smooth exponential lerp — glides like silk
  // Dynamic lerp: moves faster when far away, ultra-gentle when close
  let raf = null;
  let target = 0;
  let current = null;
  let velocity = 0;
  const precision = 0.35;

  return (container, newTarget) => {
    target = newTarget;
    if (current === null) current = container.scrollTop;
    if (Math.abs(container.scrollTop - current) > 20) {
      current = container.scrollTop;
      velocity = 0;
    }

    const step = () => {
      const diff = target - current;
      if (Math.abs(diff) < precision && Math.abs(velocity) < 0.02) {
        container.scrollTop = target;
        current = target;
        velocity = 0;
        raf = null;
        return;
      }
      const absDiff = Math.abs(diff);
      const stiffness = absDiff > 280 ? 0.095 : absDiff > 120 ? 0.072 : 0.058;
      const damping = absDiff > 280 ? 0.80 : 0.84;
      velocity = velocity * damping + diff * stiffness;
      current += velocity;
      container.scrollTop = current;
      raf = requestAnimationFrame(step);
    };

    if (!raf) raf = requestAnimationFrame(step);
  };
};

// ─── Waveform Visualizer (shows during instrumental gaps) ─────────────────────
// Canvas-based horizontal waveform with album-palette colors.
// Verse: calm, low-amplitude waves. Chorus: intense, wide waves.
const WaveformVisualizer = ({ isChorus }) => {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const startRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = 320, H = 80;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.scale(dpr, dpr);
    startRef.current = performance.now();

    const BARS = 48;
    const BAR_W = 3;
    const GAP = (W - BARS * BAR_W) / (BARS - 1);

    // Read album colors from CSS vars
    const getColors = () => {
      const s = getComputedStyle(document.documentElement);
      return [
        s.getPropertyValue('--c1-glow').trim() || '185,155,255',
        s.getPropertyValue('--c2-glow').trim() || '255,125,195',
        s.getPropertyValue('--c3-glow').trim() || '115,242,255',
      ];
    };
    let colors = getColors();
    let colorFrame = 0;

    const draw = (now) => {
      rafRef.current = requestAnimationFrame(draw);
      const elapsed = (now - startRef.current) / 1000;
      if ((colorFrame++ % 120) === 0) colors = getColors();

      ctx.clearRect(0, 0, W, H);
      const chorus = isChorus;
      const midY = H / 2;

      for (let i = 0; i < BARS; i++) {
        const x = i * (BAR_W + GAP);
        const frac = i / BARS;

        // Multiple sine waves for organic motion
        const wave1 = Math.sin(elapsed * 2.8 + frac * Math.PI * 4) * 0.6;
        const wave2 = Math.sin(elapsed * 1.6 + frac * Math.PI * 6 + 1.2) * 0.3;
        const wave3 = Math.sin(elapsed * 4.2 + frac * Math.PI * 2.5 + 2.8) * 0.15;
        const combined = wave1 + wave2 + wave3;

        // Amplitude: calm during verse, intense during chorus
        const baseAmp = chorus ? 28 : 14;
        const breath = 1 + Math.sin(elapsed * 0.8) * (chorus ? 0.25 : 0.12);
        const amp = baseAmp * breath;
        const barH = Math.max(2, Math.abs(combined) * amp);

        // Color blend based on position across waveform
        const ci = Math.floor(frac * 3) % 3;
        const alpha = 0.5 + Math.abs(combined) * (chorus ? 0.5 : 0.35);

        // Glow layer
        ctx.globalAlpha = alpha * 0.3;
        ctx.fillStyle = `rgba(${colors[ci]}, 1)`;
        ctx.beginPath();
        ctx.roundRect(x - 1, midY - barH - 1, BAR_W + 2, barH * 2 + 2, 3);
        ctx.fill();

        // Main bar
        ctx.globalAlpha = alpha;
        ctx.fillStyle = `rgba(${colors[ci]}, 1)`;
        ctx.beginPath();
        ctx.roundRect(x, midY - barH, BAR_W, barH * 2, 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    rafRef.current = requestAnimationFrame(draw);
    const onVis = () => {
      if (document.hidden) cancelAnimationFrame(rafRef.current);
      else rafRef.current = requestAnimationFrame(draw);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelAnimationFrame(rafRef.current);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [isChorus]);

  return (
    <div className="waveform-viz">
      <canvas ref={canvasRef} className="waveform-canvas" />
      <div className="waveform-label">♪</div>
    </div>
  );
};

// ─── Countdown Pulse (500ms before next lyric) ───────────────────────────────
const CountdownDots = () => (
  <div className="countdown-dots">
    {[0, 1, 2].map(i => (
      <motion.div key={i} className="cdot"
        animate={{ scale: [0.5, 1.4, 0.5], opacity: [0.15, 1, 0.15] }}
        transition={{ duration: 0.8, delay: i * 0.14, repeat: Infinity, ease: 'easeInOut' }}
      />
    ))}
  </div>
);

// ─── ClickSpark — global canvas spark burst on lyric tap ─────────────────────
const useClickSpark = () => {
  const canvasRef = useRef(null);
  const particlesRef = useRef([]);
  const rafRef = useRef(null);

  const animate = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particlesRef.current = particlesRef.current.filter(p => p.life > 0);
    for (const p of particlesRef.current) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.22;
      p.vx *= 0.965;
      p.life -= 0.024;
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life * p.life);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.1, p.size * p.life), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    if (particlesRef.current.length > 0)
      rafRef.current = requestAnimationFrame(animate);
  }, []);

  const fire = useCallback((clientX, clientY, count = 14) => {
    const canvas = canvasRef.current;
    if (!canvas || PERF === 'low') return;
    if (canvas.width !== window.innerWidth) {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    const s = getComputedStyle(document.documentElement);
    const colors = [
      `rgb(${s.getPropertyValue('--c1-glow').trim() || '185,155,255'})`,
      `rgb(${s.getPropertyValue('--c2-glow').trim() || '255,125,195'})`,
      `rgb(${s.getPropertyValue('--c3-glow').trim() || '115,242,255'})`,
    ];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.8 + Math.random() * 5.2;
      particlesRef.current.push({
        x: clientX, y: clientY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2.4,
        size: 2.5 + Math.random() * 3.5,
        life: 0.82 + Math.random() * 0.18,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(animate);
  }, [animate]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);
  return { canvasRef, fire };
};

// ─── GlitchText — cyberpunk glitch-in animation for track title ──────────────
const GlitchText = ({ text, className = '' }) => {
  const [glitching, setGlitching] = useState(false);
  const prevRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!text || text === prevRef.current) return;
    prevRef.current = text;
    setGlitching(false);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      setGlitching(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setGlitching(false), 820);
    }));
    return () => clearTimeout(timerRef.current);
  }, [text]);

  if (!text) return null;
  return (
    <span className={`glitch-text${glitching ? ' glitching' : ''} ${className}`} data-text={text}>
      {text}
    </span>
  );
};

// ─── MagneticBtn — physics-based magnetic hover for the play button ───────────
const MagneticBtn = ({ children, strength = 0.38, className = '', style, ...props }) => {
  const ref = useRef(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const onMove = useCallback((e) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setOffset({ x: (e.clientX - r.left - r.width / 2) * strength, y: (e.clientY - r.top - r.height / 2) * strength });
  }, [strength]);
  const onLeave = useCallback(() => setOffset({ x: 0, y: 0 }), []);
  return (
    <motion.div ref={ref} className={`magnetic-wrap ${className}`} style={style}
      onMouseMove={onMove} onMouseLeave={onLeave}
      animate={{ x: offset.x, y: offset.y }}
      transition={{ type: 'spring', stiffness: 320, damping: 22, mass: 0.45 }}
      {...props}
    >{children}</motion.div>
  );
};

// ─── ChorusRipple — expanding ring burst on chorus entry ─────────────────────
const ChorusRipple = ({ isChorus }) => {
  const prevRef = useRef(false);
  const [bursting, setBursting] = useState(false);
  useEffect(() => {
    if (isChorus && !prevRef.current) {
      setBursting(false);
      requestAnimationFrame(() => requestAnimationFrame(() => setBursting(true)));
      const t = setTimeout(() => setBursting(false), 1400);
      prevRef.current = true;
      return () => clearTimeout(t);
    }
    if (!isChorus) prevRef.current = false;
  }, [isChorus]);
  if (!bursting) return null;
  return (
    <div className="chorus-ripple-wrap" aria-hidden="true">
      {[0, 1, 2].map(i => <div key={i} className="chorus-ripple-ring" style={{ '--rd': i }} />)}
    </div>
  );
};

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function App() {
  // ─── Beat-Reactive Audio Analyzer ──────────────────────────────────────────
  const {
    bpm,
    energy,
    beatIntensity,
    isAnalyzing,
    connectToYouTube,
    startAnalysis,
    stopAnalysis,
    setBPMFromMetadata,
  } = useAudioAnalyzer();

  // ─── ClickSpark canvas ───────────────────────────────────────────────────────
  const { canvasRef: sparkCanvasRef, fire: fireSpark } = useClickSpark();

  const [introPhase, setIntroPhase] = useState('visible');
  useEffect(() => { const t = setTimeout(() => setIntroPhase('gone'), 2600); return () => clearTimeout(t); }, []);
  const showIntro = introPhase === 'visible';

  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionArts, setSuggestionArts] = useState({});
  const [brokenSuggestionArts, setBrokenSuggestionArts] = useState({});
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [showDrop, setShowDrop] = useState(false);
  const [song, setSong] = useState(null);
  const [lyrics, setLyrics] = useState([]);
  const [albumArt, setAlbumArt] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [revealPhase, setRevealPhase] = useState(null);
  const [ytApiReady, setYtApiReady] = useState(false);
  const [ytReady, setYtReady] = useState(false);
  const [ytVideoId, setYtVideoId] = useState(null);
  const [isVideoLoading, setIsVideoLoading] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [zenMode, setZenMode] = useState(false);
  const [isChorus, setIsChorus] = useState(false);
  const [kbHeight, setKbHeight] = useState(0);
  const [videoBg, setVideoBg] = useState(false);
  const [history, setHistory] = useState(() => JSON.parse(window.localStorage.getItem('aurora-history') || '[]'));
  const [showHistory, setShowHistory] = useState(false);
  const [isUnsynced, setIsUnsynced] = useState(false);
  const [recommendations, setRecommendations] = useState([]);
  const [showRecommendations, setShowRecommendations] = useState(false);
  const [isRecommendationsLoading, setIsRecommendationsLoading] = useState(false);
  // Instrumental / countdown states
  const [showMelody, setShowMelody] = useState(false);
  const [showCountdown, setShowCountdown] = useState(false);
  const [hasRichSync, setHasRichSync] = useState(false);
  // Manual lyrics offset (seconds) — positive = lyrics earlier, negative = lyrics later
  const [lyricsOffset, setLyricsOffset] = useState(0);
  const lyricsOffsetRef = useRef(0);
  // Section-aware state: tracks which song section we're currently in
  const [activeSection, setActiveSection] = useState('none'); // verse, pre-chorus, chorus, bridge, intro, outro, hook, none
  // Beat-reactive palette — extracted from album art colors
  const [beatPalette, setBeatPalette] = useState(['167,139,250', '244,114,182', '103,232,249']);
  // Ref to the YouTube player element for audio analysis
  const ytPlayerElRef = useRef(null);

  const introCovers = useMemo(() => {
    const arts = [
      albumArt,
      ...history.map((track) => track?.art),
      ...Object.values(suggestionArts),
      ...recommendations.map((track) => track?.art),
    ]
      .filter(Boolean)
      .map((art) => upgradeArtworkUrl(art, 'preview'));

    const uniqueArts = [...new Set(arts)];
    const seeded = uniqueArts.slice(0, 18).map((art, index) => ({
      id: `cover-${index}`,
      art,
      offset: index % 3,
    }));

    while (seeded.length < 12) {
      seeded.push({
        id: `fallback-${seeded.length}`,
        art: null,
        offset: seeded.length % 3,
      });
    }

    return seeded.slice(0, 15);
  }, [albumArt, history, recommendations, suggestionArts]);

  const lyricsRef = useRef(null);
  const lineRefs = useRef([]);
  const debRef = useRef(null);
  const inputRef = useRef(null);
  const scrollTo = useRef(makeScroller()).current;
  const rafRef = useRef(null);
  const currentTimeRef = useRef(0);
  const playStartRef = useRef(0);
  const seekBaseRef = useRef(0);
  const ytPlayerRef = useRef(null);
  const ytIsPlayingRef = useRef(false);
  const isPlayingRef = useRef(false);
  const playbackWaitingRef = useRef(false);
  const isVideoLoadingRef = useRef(false);
  const ytVideoIdRef = useRef(null);
  const seekBarRef = useRef(null);
  const isDraggingRef = useRef(false);
  const revealTimerRef = useRef(null);
  const suppressTrackEndUntilRef = useRef(0);
  const trackEndHandledRef = useRef(false);
  const lyricsDataRef = useRef([]);
  const songRef = useRef(null);
  const lastFillIdxRef = useRef(-1);
  const seekFillRef = useRef(null);
  const seekThumbRef = useRef(null);
  const curTimeDisplayRef = useRef(null);
  const searchReqRef = useRef(0);
  const activeIdxRef = useRef(-1);
  const songDurationRef = useRef(1);
  const playbackDurationRef = useRef(1);
  const wordRefsRef = useRef([]);
  const lineWordsRefsRef = useRef([]); // word DOM refs per lyric line index
  const wordTimingsRef = useRef([]);
  const fromIntroRef = useRef(true);
  const chorusRangesRef = useRef([]);
  const wrongVideoRetriedRef = useRef(new Set());
  const isChorusRef = useRef(false);
  const lineStartRef = useRef(0);
  const lineDurRef = useRef(4);
  // Instrumental refs
  const isInstrumentalRef = useRef(false);
  const isCountdownRef = useRef(false);
  // Beat pulse refs — simulated rhythm from word transitions
  const beatDecayRef = useRef(0);
  const beatRingRef = useRef(null);
  const songEnergyRef = useRef(0.5);
  const prevActiveWordIdxRef = useRef(-1);
  // Section map: lyricIndex → sectionType (verse, chorus, pre-chorus, bridge, etc.)
  const sectionMapRef = useRef([]);
  const sectionConfidenceMapRef = useRef([]);
  const sectionOverallConfidenceRef = useRef(0);
  const activeSectionRef = useRef('none');
  const structuredSectionsRef = useRef([]);

  // Mobile keyboard
  useEffect(() => {
    if (!window.visualViewport) return;
    const onVV = () => {
      const vv = window.visualViewport;
      setKbHeight(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    };
    window.visualViewport.addEventListener('resize', onVV);
    window.visualViewport.addEventListener('scroll', onVV);
    return () => { window.visualViewport.removeEventListener('resize', onVV); window.visualViewport.removeEventListener('scroll', onVV); };
  }, []);

  useEffect(() => { songDurationRef.current = song?.duration || 1; }, [song]);
  useEffect(() => { playbackDurationRef.current = song?.duration || 1; }, [song]);
  useEffect(() => { songRef.current = song; }, [song]);
  useEffect(() => { lyricsDataRef.current = lyrics; }, [lyrics]);
  useEffect(() => { lyricsOffsetRef.current = lyricsOffset; }, [lyricsOffset]);
  useEffect(() => { isVideoLoadingRef.current = isVideoLoading; }, [isVideoLoading]);
  useEffect(() => { ytVideoIdRef.current = ytVideoId; }, [ytVideoId]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  // Prewarm the fly.io backend on mount — the machine auto-stops when idle,
  // so waking it while the user is still typing hides the 2-9s cold start
  useEffect(() => {
    fetch(buildApiUrl('/api/health', {})).catch(ignoreError);
  }, []);

  const loadVideoBackground = useCallback(async (track, excludeIds = []) => {
    if (!track?.artistName || !track?.trackName) return null;
    setIsVideoLoading(true);
    try {
      const videoId = await fetchVideoId(track.artistName, track.trackName, excludeIds, track.duration || 0);
      setYtVideoId(videoId ?? null);
      return videoId ?? null;
    } catch (error) {
      ignoreError(error);
      setYtVideoId(null);
      return null;
    } finally {
      setIsVideoLoading(false);
    }
  }, []);

  const fetchRecommendations = useCallback(async (track) => {
    if (!track?.artistName) {
      setRecommendations([]);
      return;
    }
    setIsRecommendationsLoading(true);
    try {
      const queries = [
        track.artistName,
        `${track.artistName} ${track.genre || ''}`.trim(),
      ];
      const pools = await Promise.allSettled(queries.map(async (q) => {
        const res = await fetch(
          `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=20`,
          { signal: AbortSignal.timeout(6000) }
        );
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data.results) ? data.results : [];
      }));

      const merged = dedupeTracks(
        pools.flatMap((result) => (result.status === 'fulfilled' ? result.value.map(mapItunesTrack) : []))
      )
        .filter((item) => normalizeTrackTitle(item.trackName) !== normalizeTrackTitle(track.trackName))
        .sort((a, b) => {
          const aScore = scoreTrackMatch(a, track.artistName, track.trackName, track.duration || 0);
          const bScore = scoreTrackMatch(b, track.artistName, track.trackName, track.duration || 0);
          return bScore - aScore;
        })
        .slice(0, 10);

      setRecommendations(merged);
    } catch (error) {
      ignoreError(error);
      setRecommendations([]);
    } finally {
      setIsRecommendationsLoading(false);
    }
  }, []);

  const handleTrackEnded = useCallback(() => {
    if (!songRef.current) return;
    if (Date.now() < suppressTrackEndUntilRef.current) return;
    if (trackEndHandledRef.current) return;
    trackEndHandledRef.current = true;
    setIsPlaying(false);
    setShowMelody(false);
    setShowCountdown(false);
    setShowRecommendations(true);
  }, []);

  // YouTube API
  useEffect(() => {
    if (window.YT?.Player) { setYtApiReady(true); return; }
    window.onYouTubeIframeAPIReady = () => setYtApiReady(true);
    if (!document.getElementById('yt-api-script')) {
      const s = document.createElement('script');
      s.id = 'yt-api-script'; s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    }
  }, []);

  useEffect(() => {
    if (!ytApiReady) return;
    const wrap = document.getElementById('yt-player-wrap');
    if (!wrap) return;
    if (!document.getElementById('yt-player')) {
      const div = document.createElement('div'); div.id = 'yt-player'; wrap.appendChild(div);
    }
    const player = new window.YT.Player('yt-player', {
      width: '100%', height: '100%',
      host: 'https://www.youtube-nocookie.com',
      playerVars: {
        autoplay: 0,
        controls: 0,
        disablekb: 1,
        playsinline: 1,
        fs: 0,
        rel: 0,
        modestbranding: 1,
        iv_load_policy: 3,
        cc_load_policy: 0,
        origin: window.location.origin,
        // Request highest video quality — YouTube ties audio bitrate to video
        // quality, so hd1080 yields the highest-bitrate audio track available
        // (typically 192 kbps+ AAC or Opus) instead of the default ~128 kbps.
        vq: 'hd1080',
      },
      events: {
        onReady: () => {
          ytPlayerRef.current = player;
          try {
            player.unMute();
            player.setVolume(80);
            // Enforce quality immediately — `vq` param is advisory; this call
            // is authoritative and re-applies after YouTube's adaptive logic.
            player.setPlaybackQuality('hd1080');
          } catch (error) {
            ignoreError(error);
          }
          // Connect beat-reactive audio analyzer to YouTube player
          connectToYouTube(player);
          setYtReady(true);
        },
        onStateChange: (e) => {
          ytIsPlayingRef.current = (e.data === 1);
          if ((e.data === window.YT.PlayerState.CUED || e.data === window.YT.PlayerState.PLAYING) && typeof player.getDuration === 'function') {
            try {
              const ytDur = player.getDuration();
              if (ytDur && ytDur > 1) {
                playbackDurationRef.current = Math.max(songDurationRef.current, ytDur);
                // Wrong-video guard: if YouTube's duration disagrees with the
                // track's known duration by more than 15s it matched a remix,
                // live take or an entirely different song — re-search once,
                // excluding this videoId
                const known = songDurationRef.current;
                const badId = ytVideoIdRef.current;
                if (
                  known > 60 &&
                  Math.abs(ytDur - known) > 15 &&
                  badId &&
                  !wrongVideoRetriedRef.current.has(badId)
                ) {
                  wrongVideoRetriedRef.current.add(badId);
                  const currentSong = songRef.current;
                  if (currentSong && !isVideoLoadingRef.current) {
                    try { localStorage.removeItem(cacheKey('vid', currentSong.artistName, currentSong.trackName)); } catch { /* ignore */ }
                    loadVideoBackground(currentSong, [badId]).catch(ignoreError);
                  }
                }
              }
            } catch (error) {
              ignoreError(error);
            }
          }
          if (e.data === window.YT.PlayerState.PLAYING) {
            playbackWaitingRef.current = false;
            trackEndHandledRef.current = false;
            try {
              const ytT = typeof player.getCurrentTime === 'function' ? player.getCurrentTime() : currentTimeRef.current;
              currentTimeRef.current = ytT;
              seekBaseRef.current = ytT;
              playStartRef.current = performance.now();
              setCurrentTime(ytT);
              // Re-enforce quality: YouTube can silently downgrade after buffering
              player.setPlaybackQuality('hd1080');
            } catch (error) {
              ignoreError(error);
            }
            // Start beat-reactive audio analysis
            startAnalysis();
          }
          if (e.data === window.YT.PlayerState.BUFFERING || e.data === window.YT.PlayerState.CUED) {
            playbackWaitingRef.current = isPlayingRef.current;
          }
          if (e.data === window.YT.PlayerState.PAUSED || e.data === window.YT.PlayerState.ENDED) {
            // Stop beat-reactive audio analysis when paused/ended
            stopAnalysis();
          }
          if (e.data === window.YT.PlayerState.ENDED) handleTrackEnded();
        },
        onError: () => {
          const currentSong = songRef.current;
          if (!currentSong || isVideoLoadingRef.current) return;
          loadVideoBackground(currentSong, ytVideoIdRef.current ? [ytVideoIdRef.current] : []).catch(ignoreError);
        },
      },
    });
    return () => {
      setYtReady(false);
      ytPlayerRef.current = null;
      try {
        player.destroy();
      } catch (error) {
        ignoreError(error);
      }
    };
  }, [handleTrackEnded, ytApiReady, loadVideoBackground]);

  useEffect(() => {
    const yt = ytPlayerRef.current;
    if (!yt || !ytReady || !ytVideoId) return;
    ytIsPlayingRef.current = false;
    try {
      yt.cueVideoById({ videoId: ytVideoId, startSeconds: 0 });
    } catch (error) {
      ignoreError(error);
    }
  }, [ytVideoId, ytReady]);

  useEffect(() => {
    if (!videoBg || ytVideoId || !song || isVideoLoading) return;
    loadVideoBackground(song).catch(ignoreError);
  }, [videoBg, ytVideoId, song, isVideoLoading, loadVideoBackground]);

  useEffect(() => {
    const yt = ytPlayerRef.current;
    if (!yt || !ytReady) return;
    if (isPlaying) {
      playbackWaitingRef.current = true;
      try {
        yt.unMute();
        yt.setVolume(80);
        yt.playVideo();
      } catch (error) {
        ignoreError(error);
      }
    } else {
      playbackWaitingRef.current = false;
      try {
        yt.pauseVideo();
      } catch (error) {
        ignoreError(error);
      }
    }
  }, [isPlaying, ytReady]);

  // ── rAF Loop ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isPlaying || !song) { cancelAnimationFrame(rafRef.current); return; }
    seekBaseRef.current = currentTimeRef.current;
    playStartRef.current = performance.now();

    const INST_GAP = 5.75;
    const COUNT_WIN = 0.65;
    // 30fps cap on low-perf, uncapped on high-perf
    const RAF_MS = PERF === 'low' ? 1000 / 30 : PERF === 'mid' ? 1000 / 45 : 0;
    let lastRafTime = 0;

    const tick = (now) => {
      // Frame rate limiting for low-perf devices
      if (RAF_MS > 0 && now - lastRafTime < RAF_MS) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      lastRafTime = now;
      const expectsPlayerClock = !!(ytReady && ytVideoId);
      if (expectsPlayerClock && (playbackWaitingRef.current || !ytIsPlayingRef.current)) {
        const yt = ytPlayerRef.current;
        if (yt && typeof yt.getDuration === 'function') {
          try {
            const ytDur = yt.getDuration();
            if (ytDur && ytDur > 1) playbackDurationRef.current = Math.max(song.duration || 1, ytDur);
          } catch (error) {
            ignoreError(error);
          }
        }
        const frozenT = currentTimeRef.current;
        if (curTimeDisplayRef.current) curTimeDisplayRef.current.textContent = fmt(frozenT);
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const perfT = seekBaseRef.current + (performance.now() - playStartRef.current) / 1000;
      let t = perfT;
      let effectiveDuration = Math.max(song.duration || 1, playbackDurationRef.current || 1);
      if (ytIsPlayingRef.current) {
        const yt = ytPlayerRef.current;
        if (yt && typeof yt.getCurrentTime === 'function') {
          try {
            const ytT = yt.getCurrentTime();
            if (ytT > 0) {
              // Tighter sync: correct if drift > 0.2s for better lyrics accuracy
              if (Math.abs(ytT - perfT) > 0.20) {
                seekBaseRef.current = ytT; playStartRef.current = performance.now(); t = ytT;
              } else {
                // Blend: gently nudge toward YT time to prevent drift
                t = perfT + (ytT - perfT) * 0.15;
              }
            }
            if (typeof yt.getDuration === 'function') {
              const ytDur = yt.getDuration();
              if (ytDur && ytDur > 1) {
                playbackDurationRef.current = Math.max(song.duration || 1, ytDur);
                effectiveDuration = Math.max(effectiveDuration, ytDur);
              }
            }
          } catch (error) {
            ignoreError(error);
          }
        }
      }
      t = Math.min(t, effectiveDuration);

      const pct = Math.min((t / effectiveDuration) * 100, 100);
      if (seekFillRef.current) seekFillRef.current.style.width = `${pct.toFixed(2)}%`;
      if (seekThumbRef.current) seekThumbRef.current.style.left = `${pct.toFixed(2)}%`;
      if (curTimeDisplayRef.current) curTimeDisplayRef.current.textContent = fmt(t);

      // Apply manual lyrics offset — affects lyrics sync, not playback position
      const tLyrics = t + lyricsOffsetRef.current;

      const lyrs = lyricsDataRef.current;
      const idx = lyrs.length > 0 ? findActiveIdx(lyrs, tLyrics) : -1;

      // ── Word timing setup on line change ──────────────────────────────────
      if (idx !== lastFillIdxRef.current) {
        // Clean up classes from previous line's word spans
        for (const el of wordRefsRef.current) {
          if (el) { el.classList.remove('word-active', 'word-done', 'word-pre'); el.style.opacity = ''; el.style.setProperty('--wglow', '0'); }
        }
        wordRefsRef.current = lineWordsRefsRef.current[idx] || [];
        if (idx >= 0) {
          const cl = lyrs[idx];
          if (cl.words && cl.words.length > 0) {
            // Enhanced LRC / richSync — exact per-word timestamps
            wordTimingsRef.current = cl.words.map(w => ({
              ws: w.start,
              we: w.end,
              // Look-ahead: pre-warm glow 180ms before word starts
              wpre: Math.max(w.start - 0.18, cl.time),
            }));
            const firstWord = cl.words[0], lastWord = cl.words[cl.words.length - 1];
            lineStartRef.current = firstWord.start;
            lineDurRef.current = Math.max(lastWord.end - firstWord.start, 0.1);
          } else {
            // Plain LRC fallback — phoneme-aware weight estimation
            const lineStart = cl.time;
            const lineEnd = lyrs[idx + 1]?.time ?? (lineStart + 4);
            const lineDur = Math.max(lineEnd - lineStart, 0.1);
            lineStartRef.current = lineStart; lineDurRef.current = lineDur;
            const words = cl.text.split(/\s+/).filter(w => w.length > 0);
            // Phoneme-count approximation: vowel clusters + consonant clusters
            const phonemeWeight = (w) => {
              const clean = w.toLowerCase().replace(/[^a-z]/g, '');
              if (!clean) return 2;
              const vowels = (clean.match(/[aeiou]+/g) || []).length;
              const clusters = (clean.match(/[^aeiou]+/g) || []).length;
              return Math.max(1.5, vowels * 1.8 + clusters * 0.9 + clean.length * 0.15);
            };
            const weights = words.map(w => {
              let wt = phonemeWeight(w);
              if (/[,;:]$/.test(w)) wt += 1.2;
              if (/[.!?…]$/.test(w)) wt += 2.5;
              return wt;
            });
            const totalW = weights.reduce((s, w) => s + w, 0) || 1;
            let off = 0;
            wordTimingsRef.current = words.map((w, wi) => {
              const ws = lineStart + (off / totalW) * lineDur;
              off += weights[wi];
              const we = lineStart + (off / totalW) * lineDur;
              return { ws, we, wpre: Math.max(ws - 0.15, lineStart) };
            });
          }
        } else { wordTimingsRef.current = []; }
        lastFillIdxRef.current = idx;
      }

      // ── Beat pulse on line transition ──────────────────────────────
      if (idx >= 0 && idx !== activeIdxRef.current) {
        beatDecayRef.current = 1.0;
      }
      // Exponential decay: falls to ~1% in ~12 frames (0.2s at 60fps)
      beatDecayRef.current = Math.max(0, beatDecayRef.current * 0.84);
      const beatRingEl = beatRingRef.current;
      if (beatRingEl) {
        const bd = beatDecayRef.current;
        const chorus = isChorusRef.current;
        const opacMax = chorus ? 0.95 : 0.62;
        const scaleMax = chorus ? 0.14 : 0.06;
        if (Math.abs(bd - (beatRingEl.__bd || 0)) > 0.005) {
          beatRingEl.__bd = bd;
          beatRingEl.style.opacity = (bd * opacMax).toFixed(3);
          beatRingEl.style.transform = `scale(${(1 + bd * scaleMax).toFixed(4)})`;
        }
      }
      const root = document.documentElement;
      const sectionVisual = SECTION_VISUAL_INTENSITY[activeSectionRef.current] || SECTION_VISUAL_INTENSITY.none;
      const sectionLift = sectionVisual.lift + (isChorusRef.current ? 0.14 : 0);
      const sectionBloom = sectionVisual.bloom + (isChorusRef.current ? 0.08 : 0);
      root.style.setProperty('--beat-pulse', (beatDecayRef.current * (isChorusRef.current ? 1.0 : 0.72)).toFixed(3));
      root.style.setProperty('--section-lift', sectionLift.toFixed(3));
      root.style.setProperty('--section-bloom', sectionBloom.toFixed(3));

      // ── Chorus detection ───────────────────────────────────────────────────
      const inChorus = chorusRangesRef.current.length > 0 &&
        chorusRangesRef.current.some(r => tLyrics >= r.start && tLyrics <= r.end);
      if (inChorus !== isChorusRef.current) {
        isChorusRef.current = inChorus;
        // Adaptive transition duration: fast songs snap in/out, slow songs dissolve
        const energy = songEnergyRef.current;
        const dur = inChorus
          ? (energy > 0.65 ? '0.95s' : energy > 0.40 ? '1.5s' : '2.4s')
          : (energy > 0.65 ? '0.60s' : energy > 0.40 ? '1.0s' : '1.6s');
        document.documentElement.style.setProperty('--chorus-in-dur', dur);
        // Chorus entry flash — trigger CSS animation via class toggle
        const root = document.documentElement;
        root.classList.remove('chorus-leaving');
        if (inChorus) {
          root.classList.remove('chorus-entering');
          void root.offsetWidth; // force reflow to restart animation
          root.classList.add('chorus-entering');
          setTimeout(() => root.classList.remove('chorus-entering'), 1100);
        } else {
          root.classList.remove('chorus-entering');
          void root.offsetWidth;
          root.classList.add('chorus-leaving');
          setTimeout(() => root.classList.remove('chorus-leaving'), 700);
        }
        setIsChorus(inChorus);
      }

      // ── Section-aware transitions ─────────────────────────────────────────
      // Determine current section type from the section map
      const secMap = sectionMapRef.current;
      if (secMap.length > 0 && idx >= 0) {
        const newSection = secMap[idx] || 'verse';
        if (newSection !== activeSectionRef.current) {
          const prevSection = activeSectionRef.current;
          activeSectionRef.current = newSection;

          const root = document.documentElement;
          const secConfig = SECTION_TRANSITIONS[newSection] || SECTION_TRANSITIONS['verse'];
          const prevConfig = SECTION_TRANSITIONS[prevSection] || SECTION_TRANSITIONS['verse'];
          const sectionConfidence = sectionConfidenceMapRef.current[idx] || sectionOverallConfidenceRef.current || 0.45;

          // Remove old section class, add new one
          if (prevConfig.cssClass) root.classList.remove(prevConfig.cssClass);
          if (secConfig.cssClass) root.classList.add(secConfig.cssClass);

          // Set section-specific transition duration
          root.style.setProperty('--section-in-dur', secConfig.inDur);
          root.style.setProperty('--section-out-dur', secConfig.outDur);
          root.style.setProperty('--section-confidence', sectionConfidence.toFixed(3));

          setActiveSection(newSection);
        }
      }

      // ── Instrumental gap detection ─────────────────────────────────────────
      let shouldMelody = false, shouldCountdown = false;
      if (lyrs.length > 0) {
        if (idx === -1) {
          // Before first lyric
          const timeUntilFirst = lyrs[0].time - tLyrics;
          if (timeUntilFirst > COUNT_WIN) shouldMelody = true;
          else if (timeUntilFirst > 0) shouldCountdown = true;
        } else if (idx >= 0 && lyrs[idx + 1]) {
          const cl = lyrs[idx];
          const nl = lyrs[idx + 1];
          const lineContentEnd = getLineEndTime(cl, nl);
          const gap = nl.time - lineContentEnd;
          const timeUntilNext = nl.time - tLyrics;
          const pastContent = tLyrics > lineContentEnd + 0.4;
          if (gap > INST_GAP) {
            if (pastContent && timeUntilNext > COUNT_WIN) shouldMelody = true;
            else if (timeUntilNext > 0 && timeUntilNext <= COUNT_WIN) shouldCountdown = true;
          }
        }
      }
      // Only update melody/countdown state if changed (avoid React re-renders)
      if (shouldMelody !== isInstrumentalRef.current) {
        isInstrumentalRef.current = shouldMelody;
        if (PERF !== 'low') setShowMelody(shouldMelody);
      }
      if (shouldCountdown !== isCountdownRef.current) {
        isCountdownRef.current = shouldCountdown;
        if (PERF !== 'low') setShowCountdown(shouldCountdown);
      }

      // ── React re-render only on active line change ─────────────────────────
      if (idx !== activeIdxRef.current) { activeIdxRef.current = idx; setCurrentTime(t); }

      if (t < Math.max(0.25, effectiveDuration - 0.18)) rafRef.current = requestAnimationFrame(tick);
      else { handleTrackEnded(); setCurrentTime(effectiveDuration); }
    };
    rafRef.current = requestAnimationFrame(tick);
    // Pause rAF when tab is hidden — zero GPU when not visible
    const onVis = () => {
      if (document.hidden) cancelAnimationFrame(rafRef.current);
      else if (isPlaying) rafRef.current = requestAnimationFrame(tick);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelAnimationFrame(rafRef.current);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [handleTrackEnded, isPlaying, song, scrollTo, ytReady, ytVideoId]);

  const seekTo = useCallback((t) => {
    if (!song) return;
    const clamped = Math.max(0, Math.min(t, song.duration));
    suppressTrackEndUntilRef.current = Date.now() + 1400;
    trackEndHandledRef.current = false;
    playbackWaitingRef.current = !!(ytReady && ytVideoId);
    setShowRecommendations(false);
    currentTimeRef.current = clamped; seekBaseRef.current = clamped; playStartRef.current = performance.now();
    setCurrentTime(clamped);
    const pct = Math.min((clamped / song.duration) * 100, 100);
    if (seekFillRef.current) seekFillRef.current.style.width = `${pct.toFixed(1)}%`;
    if (seekThumbRef.current) seekThumbRef.current.style.left = `${pct.toFixed(1)}%`;
    if (curTimeDisplayRef.current) curTimeDisplayRef.current.textContent = fmt(clamped);
    const yt = ytPlayerRef.current;
    if (yt) {
      try {
        yt.seekTo(clamped, true);
      } catch (error) {
        ignoreError(error);
      }
    }
  }, [song, ytReady, ytVideoId]);

  const getSeekTime = useCallback((clientX) => {
    const bar = seekBarRef.current;
    if (!bar || !song) return null;
    const r = bar.getBoundingClientRect();
    return Math.max(0, Math.min((clientX - r.left) / r.width, 1)) * song.duration;
  }, [song]);

  const handleSeekStart = useCallback((e) => {
    if (!song) return;
    e.preventDefault();
    isDraggingRef.current = true;
    seekBarRef.current?.setAttribute('data-active', '');
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const t = getSeekTime(clientX);
    if (t !== null) seekTo(t);
  }, [song, getSeekTime, seekTo]);

  useEffect(() => {
    const onMove = (e) => {
      if (!isDraggingRef.current) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const bar = seekBarRef.current;
      if (!bar) return;
      const r = bar.getBoundingClientRect();
      const frac = Math.max(0, Math.min((clientX - r.left) / r.width, 1));
      const t = frac * songDurationRef.current;
      currentTimeRef.current = t; seekBaseRef.current = t; playStartRef.current = performance.now();
      const pct = frac * 100;
      if (seekFillRef.current) seekFillRef.current.style.width = `${pct.toFixed(1)}%`;
      if (seekThumbRef.current) seekThumbRef.current.style.left = `${pct.toFixed(1)}%`;
      if (curTimeDisplayRef.current) curTimeDisplayRef.current.textContent = fmt(t);
    };
    const onUp = (e) => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      seekBarRef.current?.removeAttribute('data-active');
      const clientX = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
      const bar = seekBarRef.current;
      if (!bar) return;
      const r = bar.getBoundingClientRect();
      const t = Math.max(0, Math.min((clientX - r.left) / r.width, 1)) * songDurationRef.current;
      suppressTrackEndUntilRef.current = Date.now() + 1400;
      trackEndHandledRef.current = false;
      setShowRecommendations(false);
      currentTimeRef.current = t; seekBaseRef.current = t; playStartRef.current = performance.now();
      setCurrentTime(t);
      const yt = ytPlayerRef.current;
      if (yt) {
        try {
          yt.seekTo(t, true);
        } catch (error) {
          ignoreError(error);
        }
      }
    };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false }); window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove); window.removeEventListener('touchend', onUp);
    };
  }, []);

  // Suggestions — dual-source: backend tries Genius first, falls back to LRCLib
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setSuggestions([]); setSuggestionArts({}); setBrokenSuggestionArts({}); setShowDrop(false); setIsSuggesting(false); return; }
    setIsSuggesting(true);
    const reqId = ++searchReqRef.current;
    clearTimeout(debRef.current);
    debRef.current = setTimeout(async () => {
      try {
        const suggestionQueries = buildSuggestionQueries(q);
        // Each source parses its own body and fails independently — previously a
        // single slow response hit AbortSignal.timeout mid-body-read, json()
        // threw, and the outer catch hid ALL suggestions including valid ones.
        const itunesRequests = suggestionQueries.map((term) => (
          fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=8`, {
            signal: AbortSignal.timeout(5000),
          })
            .then((r) => r.json())
            .then((d) => (Array.isArray(d.results) ? d.results : []))
            .catch(() => [])
        ));
        const geniusRequest = fetch(buildApiUrl('/api/genius/search', { q }), {
          signal: AbortSignal.timeout(8000),
        })
          .then((r) => r.json())
          .then((d) => (!d.error && Array.isArray(d) ? d : []))
          .catch(() => []);

        const [geniusData, ...itunesPools] = await Promise.all([geniusRequest, ...itunesRequests]);
        const itunesData = dedupeTracks(itunesPools.flat().map(mapItunesTrack));

        const merged = [
          ...geniusData.map((t) => ({
            id: t.id || t.lrcId,
            trackName: t.title,
            artistName: t.artist,
            albumName: '',
            duration: t.duration || 0,
            url: t.url || null,
            art: t.art || null,
            genre: '',
            hasSynced: t.hasSynced ?? true,
            lrcId: t.lrcId || null,
            source: 'genius',
          })),
          ...itunesData,
        ];

        let results = dedupeTracks(merged)
          .map((item) => ({ item, score: scoreSuggestionCandidate(item, q) }))
          .filter(({ item, score }) => {
            if (score < 14) return false;
            if (!item.trackName || !item.artistName) return false;
            if (SEARCH_NOISE_RE.test(item.trackName) && tokenOverlap(item.trackName, q) < 0.45) return false;
            return true;
          })
          .sort((a, b) => b.score - a.score)
          .slice(0, 8)
          .map(({ item }) => item);

        const hasReliableTimedResult = results.some((item) => (item.duration || 0) > 30 && item.source === 'itunes');
        if (hasReliableTimedResult) {
          results = results.filter((item) => (item.duration || 0) > 0 || item.source === 'itunes');
        }

        if (reqId !== searchReqRef.current) return;
        setSuggestions(results); 
        setBrokenSuggestionArts({});
        setShowDrop(results.length > 0);
        
        const artMap = {};
        results.forEach(t => { 
           if (t.art) artMap[`${t.artistName}|${t.trackName}`.toLowerCase()] = upgradeArtworkUrl(t.art, 'thumb'); 
        });
        setSuggestionArts({ ...artMap });

        const needArt = results.filter(t => !t.art);
        if (needArt.length > 0) {
          Promise.allSettled(needArt.map(async (t) => {
            const key = `${t.artistName}|${t.trackName}`.toLowerCase();
            try {
              const r = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(`${t.artistName} ${t.trackName}`)}&media=music&limit=3&entity=song`);
              const d = await r.json();
              const fallback = Array.isArray(d.results)
                ? d.results
                  .map((result) => ({ result, score: scoreTrackMatch(result, t.artistName, t.trackName, t.duration || 0) }))
                  .sort((a, b) => b.score - a.score)[0]?.result
                : null;
              const art = fallback?.artworkUrl100 ? upgradeArtworkUrl(fallback.artworkUrl100, 'thumb') : null;
              if (art) artMap[key] = art;
            } catch (error) {
              ignoreError(error);
            }
          })).then(() => {
            if (reqId === searchReqRef.current) setSuggestionArts({ ...artMap });
          });
        }
      } catch (error) {
        ignoreError(error);
        if (reqId !== searchReqRef.current) return;
        setSuggestions([]);
        setShowDrop(false);
      }
      finally {
        if (reqId === searchReqRef.current) setIsSuggesting(false);
      }
    }, 180);
    return () => clearTimeout(debRef.current);
  }, [query]);

  // Scroll motion blur removed — applying filter:blur on every scroll frame
  // forces the compositor to re-rasterize the entire lyrics container,
  // causing micro-jank. The CSS mask gradient already provides depth cues.

  const stopAll = useCallback(() => {
    cancelAnimationFrame(rafRef.current); clearTimeout(revealTimerRef.current);
    ytIsPlayingRef.current = false; setIsPlaying(false);
    playbackWaitingRef.current = false;
    trackEndHandledRef.current = false;
    suppressTrackEndUntilRef.current = 0;
    const yt = ytPlayerRef.current;
    if (yt) {
      try {
        yt.stopVideo();
      } catch (error) {
        ignoreError(error);
      }
    }
    setYtVideoId(null);
    isInstrumentalRef.current = false; isCountdownRef.current = false;
    setShowMelody(false); setShowCountdown(false);
    setIsVideoLoading(false);
    // ── Always fully reset chorus — prevents state bleeding back to main menu
    isChorusRef.current = false; setIsChorus(false);
    chorusRangesRef.current = [];
    try {
      document.documentElement.classList.remove('chorus-entering');
      document.documentElement.classList.remove('chorus-leaving');
    } catch (error) {
      ignoreError(error);
    }
    // Reset beat pulse state
    beatDecayRef.current = 0;
    prevActiveWordIdxRef.current = -1;
    document.documentElement.style.setProperty('--beat-pulse', '0');
    document.documentElement.style.setProperty('--section-lift', '0.06');
    document.documentElement.style.setProperty('--section-bloom', '0.04');
    const br = beatRingRef.current;
    if (br) { br.style.opacity = '0'; br.style.transform = 'scale(1)'; }
    // Reset section state
    sectionMapRef.current = [];
    sectionConfidenceMapRef.current = [];
    sectionOverallConfidenceRef.current = 0;
    activeSectionRef.current = 'none';
    structuredSectionsRef.current = [];
    setActiveSection('none');
    const secRoot = document.documentElement;
    for (const cls of [...secRoot.classList]) {
      if (cls.startsWith('section-')) secRoot.classList.remove(cls);
    }
  }, []);

  // Load track — immediately show LRC lyrics, upgrade to rich sync in background
  const loadTrack = useCallback(async (track) => {
    stopAll();
    trackEndHandledRef.current = false;
    suppressTrackEndUntilRef.current = Date.now() + 1800;
    setShowRecommendations(false);
    setRecommendations([]);
    setShowSearch(false); setQuery(''); setSuggestions([]); setSuggestionArts({}); setShowDrop(false);
    setCurrentTime(0); currentTimeRef.current = 0;
    seekBaseRef.current = 0; playStartRef.current = performance.now();
    activeIdxRef.current = -1; lastFillIdxRef.current = -1;
    wordRefsRef.current = []; wordTimingsRef.current = [];
    if (seekFillRef.current) seekFillRef.current.style.width = '0%';
    if (seekThumbRef.current) seekThumbRef.current.style.left = '0%';
    if (curTimeDisplayRef.current) curTimeDisplayRef.current.textContent = fmt(0);
    setAlbumArt(null); setRevealPhase(null);
    setHasRichSync(false);
    setIsLoading(true);

    let workingTrack = { ...track };
    const canonicalTrack = await resolveCanonicalTrack(workingTrack);
    if (canonicalTrack) {
      workingTrack = { ...workingTrack, ...canonicalTrack };
    }

    let lrc = cacheGet('lrc', workingTrack.artistName, workingTrack.trackName);

    // Kick off the YouTube video search in parallel with the lyrics chain —
    // it used to run after every lyrics fetch and was the longest pole in
    // time-to-audio
    const videoStartedEarly = (workingTrack.duration || 0) > 0;
    if (videoStartedEarly) loadVideoBackground(workingTrack).catch(ignoreError);

    // Step 1: Try LRCLib exact match for synced lyrics + duration
    if (!lrc) try {
      const lrct = await fetch(`https://lrclib.net/api/get?artist_name=${encodeURIComponent(workingTrack.artistName)}&track_name=${encodeURIComponent(workingTrack.trackName)}`);
      const lrdata = await lrct.json();
      if (lrdata && lrdata.syncedLyrics) {
        lrc = lrdata.syncedLyrics;
        workingTrack.id = lrdata.id;
        workingTrack.duration = lrdata.duration || workingTrack.duration || 0;
      }
    } catch (error) {
      ignoreError(error);
    }

    // Step 1b: If exact match failed, try LRCLib search (fuzzy)
    if (!lrc) {
      try {
        const lrcSearch = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(`${workingTrack.artistName} ${workingTrack.trackName}`)}`);
        const lrcResults = await lrcSearch.json();
        if (Array.isArray(lrcResults) && lrcResults.length > 0) {
          const scored = lrcResults
            .filter(r => r.syncedLyrics)
            .map(r => ({
              r,
              s: scoreTrackMatch(
                { artistName: r.artistName, trackName: r.trackName, duration: r.duration || 0 },
                workingTrack.artistName,
                workingTrack.trackName,
                workingTrack.duration || 0,
              ),
            }))
            .sort((a, b) => b.s - a.s);
          const best = scored.find((entry) => entry.s >= 55)?.r || scored[0]?.r || lrcResults.find(r => r.syncedLyrics);
          if (best && best.syncedLyrics) {
            lrc = best.syncedLyrics;
            workingTrack.id = best.id;
            workingTrack.duration = best.duration || workingTrack.duration || 0;
            workingTrack.artistName = best.artistName || workingTrack.artistName;
            workingTrack.trackName = best.trackName || workingTrack.trackName;
          }
        }
      } catch (error) {
        ignoreError(error);
      }
    }

    // Step 1c: Try backend structured lyrics (may have synced LRC from Musixmatch/Timestamp APIs)
    if (!lrc) {
      try {
        const structRes = await fetch(buildApiUrl('/api/lyrics/structured', {
          artist: workingTrack.artistName,
          title: workingTrack.trackName,
        }));
        const structData = await structRes.json();
        if (structData.syncedLrc) {
          lrc = structData.syncedLrc;
          if (structData.sections?.length > 0) {
            structuredSectionsRef.current = structData.sections;
          }
        }
      } catch (error) {
        ignoreError(error);
      }
    }

    // Step 2: If no synced lyrics found, try Genius as unsynced fallback (blocking)
    if (!lrc) {
      const geniusUrl = workingTrack.url || buildGeniusUrl(workingTrack.artistName, workingTrack.trackName);
      try {
        const gl = await fetch(buildApiUrl('/api/genius/lyrics', { url: geniusUrl }));
        const gdata = await gl.json();
        if (gdata.lyrics) {
          setIsUnsynced(true);
          const rawLines = gdata.lyrics.split('\n').filter(l => l.trim() && !l.match(/^\[.+\]$/));
          const estimatedDuration = workingTrack.duration || rawLines.length * 4;
          workingTrack.duration = estimatedDuration;
          const interval = estimatedDuration / Math.max(rawLines.length, 1);
          lrc = '';
          for (let i = 0; i < rawLines.length; i++) {
            const t = i * interval;
            const mm = String(Math.floor(t / 60)).padStart(2, '0');
            const ss = String(Math.floor(t % 60)).padStart(2, '0');
            const cs = String(Math.floor((t % 1) * 100)).padStart(2, '0');
            lrc += `[${mm}:${ss}.${cs}] ${rawLines[i].trim()}\n`;
          }
          // Genius chorus detection from this response
          const geniusChorusRanges = (parsed) => detectChorusFromGenius(parsed, gdata.lyrics);
          // Store for later use
          workingTrack._geniusChorusFn = geniusChorusRanges;
        }
      } catch (error) {
        ignoreError(error);
      }
    } else {
      setIsUnsynced(false);
    }

    // Step 3: Duration estimation fallback
    if (!workingTrack.duration || workingTrack.duration === 0) {
      if (lrc) {
        const times = [...lrc.matchAll(/\[(\d{2}):(\d{2})\.(\d{2,3})\]/g)];
        if (times.length > 0) {
          const last = times[times.length - 1];
          workingTrack.duration = parseTS(last[1], last[2], last[3]) + 10;
        } else {
          workingTrack.duration = 240;
        }
      } else {
        workingTrack.duration = 240;
      }
    }

    setIsLoading(false);
    if (!lrc) return;

    cacheSet('lrc', workingTrack.artistName, workingTrack.trackName, lrc);
    setSong(workingTrack);
    setHistory(prev => {
      const filtered = prev.filter(t => t.id !== workingTrack.id && t.trackName !== workingTrack.trackName);
      const next = [workingTrack, ...filtered].slice(0, 20);
      window.localStorage.setItem('aurora-history', JSON.stringify(next));
      return next;
    });
    
    const originalLrc = parseLRC(lrc);
    const lrcLyrics = injectGaps(originalLrc);
    const hasEnhLRC = countRichLines(originalLrc) > originalLrc.length * 0.3;
    const initialStructuredSections = structuredSectionsRef.current;
    setLyrics(lrcLyrics);
    lyricsDataRef.current = lrcLyrics;

    // Chorus detection: run all detectors and fuse — corroborated ranges win,
    // and no single partial result can hide later choruses anymore
    const geniusRanges = workingTrack._geniusChorusFn ? workingTrack._geniusChorusFn(lrcLyrics) : [];
    const sectionRanges = initialStructuredSections.length > 0
      ? buildChorusRangesFromSections(lrcLyrics, initialStructuredSections)
      : [];
    const statisticalRanges = detectChorus(lrcLyrics);
    const chorusRanges = weightChorusRangesByIntensity(
      lrcLyrics,
      fuseChorusRanges(geniusRanges, sectionRanges, statisticalRanges),
    );
    chorusRangesRef.current = chorusRanges;
    isChorusRef.current = false; setIsChorus(false);

    const energy = estimateSongEnergy(lrcLyrics);
    songEnergyRef.current = energy;
    const initDur = energy > 0.65 ? '0.95s' : energy > 0.40 ? '1.5s' : '2.4s';
    document.documentElement.style.setProperty('--chorus-in-dur', initDur);
    // Reset section state
    if (initialStructuredSections.length > 0) {
      const sectionDetail = mapSectionsToLyricLinesDetailed(lrcLyrics, initialStructuredSections);
      sectionMapRef.current = sectionDetail.types;
      sectionConfidenceMapRef.current = sectionDetail.confidence;
      sectionOverallConfidenceRef.current = sectionDetail.overallConfidence;
    } else {
      sectionMapRef.current = [];
      sectionConfidenceMapRef.current = [];
      sectionOverallConfidenceRef.current = 0;
    }
    activeSectionRef.current = 'none';
    structuredSectionsRef.current = initialStructuredSections;
    setActiveSection('none');
    // Clean up any section CSS classes from previous track
    const secRoot = document.documentElement;
    for (const cls of secRoot.classList) {
      if (cls.startsWith('section-')) secRoot.classList.remove(cls);
    }

    lineRefs.current = [];
    setRevealPhase('playing');
    if (hasEnhLRC) setHasRichSync(true);

    // Background: Fetch structured lyrics for section-aware transitions
    fetch(buildApiUrl('/api/lyrics/structured', {
      artist: workingTrack.artistName,
      title: workingTrack.trackName,
    }))
      .then(r => r.json())
      .then(structured => {
        if (structured.sections?.length > 0) {
          structuredSectionsRef.current = structured.sections;
          const currentLyrics = lyricsDataRef.current;
          if (currentLyrics.length > 0) {
            const sectionDetail = mapSectionsToLyricLinesDetailed(currentLyrics, structured.sections);
            sectionMapRef.current = sectionDetail.types;
            sectionConfidenceMapRef.current = sectionDetail.confidence;
            sectionOverallConfidenceRef.current = sectionDetail.overallConfidence;
            const sectionChorusRanges = sectionDetail.overallConfidence >= 0.34
              ? buildChorusRangesFromSections(currentLyrics, structured.sections)
              : [];
            if (sectionChorusRanges.length > 0) {
              chorusRangesRef.current = sectionChorusRanges;
            }
          }
        }
      })
      .catch(ignoreError);

    // Background: Fetch richSync upgrade from LRCLib
    if (workingTrack.id && !hasEnhLRC) {
      fetch(`https://lrclib.net/api/get/${workingTrack.id}`)
        .then(r => r.json())
        .then(data => {
          if (data.richSyncLyrics) {
            const richLyrics = parseRichSync(data.richSyncLyrics);
            if (richLyrics && richLyrics.length > 0) {
              const injected = injectGaps(richLyrics);
              setLyrics(injected);
              lyricsDataRef.current = injected;
              if (structuredSectionsRef.current.length > 0) {
                const sectionDetail = mapSectionsToLyricLinesDetailed(injected, structuredSectionsRef.current);
                sectionMapRef.current = sectionDetail.types;
                sectionConfidenceMapRef.current = sectionDetail.confidence;
                sectionOverallConfidenceRef.current = sectionDetail.overallConfidence;
              }
              const sectionChorusRanges = structuredSectionsRef.current.length > 0 && sectionOverallConfidenceRef.current >= 0.34
                ? buildChorusRangesFromSections(injected, structuredSectionsRef.current)
                : [];
              chorusRangesRef.current = sectionChorusRanges.length > 0
                ? sectionChorusRanges
                : detectChorus(injected);
              setHasRichSync(true);
              lastFillIdxRef.current = -2;
            }
          }
        })
        .catch(ignoreError);
    }

    // Background: Fetch Genius lyrics for chorus detection upgrade (non-blocking)
    // Only if we have synced lyrics from LRCLib and didn't already get Genius
    if (!workingTrack._geniusChorusFn) {
      const geniusUrl = workingTrack.url || buildGeniusUrl(workingTrack.artistName, workingTrack.trackName);
      fetch(buildApiUrl('/api/genius/lyrics', { url: geniusUrl }))
        .then(r => r.json())
        .then(gdata => {
          if (gdata.lyrics) {
            const currentLyrics = lyricsDataRef.current;
            if (currentLyrics && currentLyrics.length > 0) {
              const geniusChorus = detectChorusFromGenius(currentLyrics, gdata.lyrics);
              if (geniusChorus.length > 0) {
                chorusRangesRef.current = geniusChorus;
              }
            }
          }
        })
        .catch(ignoreError);
    }

    // Fetch art: prefer Genius art from search result (correct cover),
    // fall back to iTunes only if no art was provided
    const updateHistoryArt = (artUrl) => {
      // Update history entry with the art URL so covers show in history
      setHistory(prev => {
        const updated = prev.map(t =>
          (t.id === workingTrack.id || t.trackName === workingTrack.trackName) ? { ...t, art: artUrl } : t
        );
        window.localStorage.setItem('aurora-history', JSON.stringify(updated));
        return updated;
      });
    };

    const applyArt = (art) => {
      if (!art) return;
      const hiResArt = upgradeArtworkUrl(art, 'full');
      updateHistoryArt(hiResArt);
      // For iTunes URLs, apply low-res first then upgrade
      if (hiResArt.includes('mzstatic.com') || hiResArt.includes('genius.com') || hiResArt.includes('images.genius.com')) {
        const loRes = upgradeArtworkUrl(hiResArt, 'preview');
        setAlbumArt(loRes);
        extractColors(loRes).then(c => { if (c) { applyColors(c); setBeatPalette(c); } });
        if (PERF !== 'low') setTimeout(() => setAlbumArt(hiResArt), 450);
      } else {
        // Genius art — use directly
        setAlbumArt(hiResArt);
        extractColors(hiResArt).then(c => { if (c) { applyColors(c); setBeatPalette(c); } });
      }
    };

    if (workingTrack.art) {
      // Already have art from search results (Genius RapidAPI) — use it directly
      applyArt(workingTrack.art);
    } else {
      // Fallback to iTunes for tracks without art (e.g. LRCLib results)
      fetchTrackMeta(workingTrack.artistName, workingTrack.trackName)
        .then(art => applyArt(art))
        .catch(ignoreError);
    }
    fetchRecommendations(workingTrack).catch(ignoreError);
    if (!videoStartedEarly) loadVideoBackground(workingTrack).catch(ignoreError);
  }, [fetchRecommendations, loadVideoBackground, stopAll]);

  const activeLyricTime = useMemo(
    () => currentTime + lyricsOffset,
    [currentTime, lyricsOffset],
  );

  const activeIndex = useMemo(() => {
    if (!lyrics.length) return -1;
    return findActiveIdx(lyrics, activeLyricTime);
  }, [activeLyricTime, lyrics]);

  // During instrumental/countdown, dim all lines (effectiveActiveIndex = -1)
  const effectiveActiveIndex = (showMelody || showCountdown) ? -1 : activeIndex;

  // Smooth scroll — scroll to active line (or upcoming during countdown)
  // Target: active line sits at ~38% from top (Apple Music style — slightly above center)
  useEffect(() => {
    const container = lyricsRef.current;
    const scrollIdx = showCountdown
      ? Math.min(activeIndex + 1, lyrics.length - 1)
      : activeIndex;
    const el = lineRefs.current[scrollIdx];
    if (!container || !el || scrollIdx < 0) return;
    const cr = container.getBoundingClientRect(), er = el.getBoundingClientRect();
    const targetOffset = cr.height * 0.38;
    scrollTo(container, container.scrollTop + er.top - cr.top - targetOffset + er.height * 0.5);
  }, [activeIndex, showCountdown, lyrics.length, scrollTo]);

  useEffect(() => {
    const h = e => {
      if (e.code !== 'Space' || e.target.tagName === 'INPUT') return;
      e.preventDefault();
      if (revealPhase === 'cover') { clearTimeout(revealTimerRef.current); setRevealPhase('playing'); }
      else if (song && revealPhase === 'playing') setIsPlaying(p => !p);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [song, revealPhase]);

  const handleBack = useCallback(() => {
    stopAll();
    trackEndHandledRef.current = false;
    setShowRecommendations(false);
    setRecommendations([]);
    setSong(null); setLyrics([]); setAlbumArt(null);
    setCurrentTime(0); currentTimeRef.current = 0;
    setRevealPhase(null); setQuery('');
    setHasRichSync(false);
    setZenMode(false);
    setActiveSection('none');
    // Reset colors to default instantly (no residual album hues on hero screen)
    applyColors(null, true);
  }, [stopAll]);

  const handleReset = useCallback(() => {
    cancelAnimationFrame(rafRef.current); ytIsPlayingRef.current = false; setIsPlaying(false);
    suppressTrackEndUntilRef.current = Date.now() + 1200;
    trackEndHandledRef.current = false;
    setShowRecommendations(false);
    seekTo(0);
    const yt = ytPlayerRef.current;
    if (yt) {
      try {
        yt.pauseVideo();
        yt.seekTo(0, true);
      } catch (error) {
        ignoreError(error);
      }
    }
  }, [seekTo]);

  const duration = song?.duration || 1;
  const hasPlayer = !!(song || isLoading);

  // Font sizing is now handled via data-len attribute + CSS — avoids inline style flash

  const sboxRef = useRef(null);

  const renderLyricText = useCallback((line, lineIdx) => {
    if (line.isGap) return line.text;
    const displayWords = line.words
      ? line.words.map(w => w.text)
      : (line.text || '').split(/\s+/).filter(Boolean);
    if (!lineWordsRefsRef.current[lineIdx]) lineWordsRefsRef.current[lineIdx] = [];
    return displayWords.map((word, wi) => (
      <span
        key={wi}
        className="lyr-word"
        ref={el => { if (lineWordsRefsRef.current[lineIdx]) lineWordsRefsRef.current[lineIdx][wi] = el; }}
      >
        {word}{wi < displayWords.length - 1 ? '\u00a0' : ''}
      </span>
    ));
  }, []);

  const SearchBox = (
    <div className="search-area" ref={sboxRef} style={{ display: 'flex', justifyContent: 'center', position: 'relative' }}>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
        <div className={`sbox${showDrop ? ' open' : ''}`}>
          {isSuggesting ? <Loader size={14} className="spin sico" /> : <Search size={14} className="sico" />}
          <input
            ref={inputRef} type="text" placeholder="Search artist or song…" value={query}
            onChange={e => setQuery(e.target.value)}
            onFocus={() => { setShowHistory(false); if (suggestions.length > 0) setShowDrop(true); }}
            onBlur={() => setTimeout(() => setShowDrop(false), 160)}
            onKeyDown={e => { if (e.key === 'Escape') { setShowDrop(false); inputRef.current?.blur(); } }}
            autoComplete="off"
          />
          <AnimatePresence>
            {query && (
              <motion.button className="clr-btn"
                initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }}
                transition={{ duration: 0.14, type: 'spring', stiffness: 400, damping: 22 }}
                onMouseDown={() => { setQuery(''); setSuggestions([]); setSuggestionArts({}); setShowDrop(false); inputRef.current?.focus(); }}
              ><X size={12} /></motion.button>
            )}
          </AnimatePresence>
        </div>
        <button className="history-toggle" onMouseDown={() => setShowHistory(v => !v)} title="Listening History">
          <History size={17} />
        </button>
      </div>
      
      {/* Local Files Hint (More Details & All Local logic hint) */}
      <AnimatePresence>
        {!query && !showDrop && !showHistory && (
           <motion.div className="local-hint" 
             initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
             style={{ position: 'absolute', top: '100%', left: 0, right: 0, textAlign: 'center', marginTop: 12, fontSize: '0.7rem', color: 'rgba(255,255,255,0.3)', fontFamily: 'var(--mono)' }}
           >
           </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showDrop && suggestions.length > 0 && (
          <motion.div
            className="drop"
            style={{
              maxHeight: (() => {
                if (sboxRef.current) {
                  const rect = sboxRef.current.getBoundingClientRect();
                  const dropTop = rect.bottom;
                  const available = window.innerHeight - dropTop - 28;
                  return `${Math.max(120, Math.min(available, window.innerHeight * 0.44))}px`;
                }
                return kbHeight > 0 ? `calc(100dvh - ${kbHeight + 160}px)` : '44dvh';
              })(),
            }}
            initial={{ opacity: 0, y: -10, scaleY: 0.88, transformOrigin: 'top center' }}
            animate={{ opacity: 1, y: 0, scaleY: 1 }}
            exit={{ opacity: 0, y: -6, scaleY: 0.94 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
          >
            <div className="drop-lbl">Best Matches</div>
            {suggestions.map((track, i) => {
              const key = `${track.artistName}|${track.trackName}`.toLowerCase();
              const art = brokenSuggestionArts[key] ? null : suggestionArts[key];
              return (
                <motion.button key={track.id ?? i} className="drop-item"
                  onMouseDown={() => { setShowHistory(false); loadTrack(track); }}
                  initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.025, duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                >
                  {art ? <img src={art} alt="" className="dico dart" /> : <span className="dico">♪</span>}
                  <span className="dtxt">
                    <span className="dtitle">{track.trackName}</span>
                    <span className="dartist">{track.artistName}{track.albumName ? ` · ${track.albumName}` : ''}</span>
                  </span>
                  <span className="ddur">{fmt(track.duration ?? 0)}</span>
                </motion.button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showHistory && !showDrop && history.length > 0 && (
          <motion.div
            className="drop"
            style={{
              maxHeight: (() => {
                if (sboxRef.current) {
                  const rect = sboxRef.current.getBoundingClientRect();
                  return `${Math.max(120, Math.min(window.innerHeight - rect.bottom - 28, window.innerHeight * 0.44))}px`;
                }
                return '44dvh';
              })(),
            }}
            initial={{ opacity: 0, y: -10, scaleY: 0.88, transformOrigin: 'top center' }}
            animate={{ opacity: 1, y: 0, scaleY: 1 }}
            exit={{ opacity: 0, y: -6, scaleY: 0.94 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
          >
            <div className="drop-lbl" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Listening History</span>
              <button className="clr-btn" style={{ position: 'relative', width: 'auto', height: 'auto', padding: '2px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.1)' }} onMouseDown={() => { setHistory([]); window.localStorage.removeItem('aurora-history'); setShowHistory(false); }}>Clear</button>
            </div>
            {history.map((track, i) => (
              <motion.button key={track.id ?? i} className="drop-item"
                onMouseDown={() => { setShowHistory(false); loadTrack(track); }}
                initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.025, duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              >
                {track.art ? <img src={track.art.replace(/\d+x\d+bb/, '60x60bb')} alt="" className="dico dart" /> : <span className="dico"><History size={14} /></span>}
                <span className="dtxt">
                  <span className="dtitle">{track.trackName}</span>
                  <span className="dartist">{track.artistName}{track.albumName ? ` · ${track.albumName}` : ''}</span>
                </span>
                <span className="ddur">{fmt(track.duration ?? 0)}</span>
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  return (
    <MotionConfig reducedMotion="never">
    <LayoutGroup>
    <div className={`app${isChorus ? ' chorus-mode' : ''}${!isPlaying && song ? ' app-paused' : ''}${zenMode ? ' zen' : ''}${videoBg ? ' video-bg-active' : ''}${isUnsynced ? ' unsynced-mode' : ''}${activeSection !== 'none' ? ` section-active section-is-${activeSection}` : ''}`}>

      <AnimatePresence>
        {showIntro && (
          <motion.div className="intro-overlay" key="intro"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, filter: 'blur(10px)', transition: { duration: 0.72, ease: [0.16, 1, 0.3, 1] } }}
          >
            <div className="intro-cover-wall" aria-hidden="true">
              {introCovers.map((cover, index) => (
                <motion.div
                  key={cover.id}
                  className={`intro-cover-tile${cover.art ? '' : ' intro-cover-tile-fallback'}`}
                  initial={{ opacity: 0, y: 24, scale: 0.92 }}
                  animate={{
                    opacity: cover.art ? 1 : 0.42,
                    y: [0, cover.offset === 0 ? -18 : cover.offset === 1 ? 14 : -10, 0],
                    x: [0, index % 2 === 0 ? 10 : -10, 0],
                    rotate: [index % 2 === 0 ? -3 : 3, index % 3 === 0 ? 2 : -2, index % 2 === 0 ? -3 : 3],
                    scale: [1, 1.035, 1],
                  }}
                  transition={{
                    opacity: { duration: 0.8, delay: 0.05 * Math.min(index, 8) },
                    y: { duration: 16 + (index % 4) * 2, repeat: Infinity, ease: 'easeInOut' },
                    x: { duration: 18 + (index % 5) * 1.5, repeat: Infinity, ease: 'easeInOut' },
                    rotate: { duration: 20 + (index % 3) * 2, repeat: Infinity, ease: 'easeInOut' },
                    scale: { duration: 14 + (index % 4), repeat: Infinity, ease: 'easeInOut' },
                  }}
                >
                  {cover.art ? (
                    <img src={cover.art} alt="" className="intro-cover-img" />
                  ) : (
                    <div className="intro-cover-fill">
                      <Sparkles size={18} strokeWidth={1.25} />
                      <span>aurora</span>
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
            <motion.div className="intro-glow"
              initial={{ opacity: 0, scale: 0.72 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 1.6, ease: [0.16, 1, 0.3, 1] }}
            />
            <div className="intro-veil" />
            <div className="intro-stage">
              <motion.div className="intro-badge"
                initial={{ opacity: 0, y: 10, filter: 'blur(6px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.08 }}
              >welcome back</motion.div>
              <motion.div className="hero-logo intro-logo"
                layoutId="brand-lockup"
                initial={{ opacity: 0, scale: 0.9, y: 18, filter: 'blur(10px)' }}
                animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
                transition={{ duration: 1.0, ease: [0.16, 1, 0.3, 1], delay: 0.12 }}
              ><Sparkles size={26} strokeWidth={1.2} /><span>aurora</span></motion.div>
              <motion.p className="hero-sub intro-sub"
                initial={{ opacity: 0, y: 12, letterSpacing: '0.24em' }}
                animate={{ opacity: 1, y: 0, letterSpacing: '0.16em' }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.24 }}
              >A more cinematic way to live inside your music.</motion.p>
              <motion.div className="hero-line intro-line"
                layoutId="brand-line"
                initial={{ scaleX: 0, opacity: 0 }}
                animate={{ scaleX: 1, opacity: 1 }}
                transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.36 }}
              />
              <motion.div className="intro-panel"
                initial={{ opacity: 0, y: 26, scale: 0.96, filter: 'blur(12px)' }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
                transition={{ duration: 0.95, ease: [0.16, 1, 0.3, 1], delay: 0.4 }}
              >
                <div className="intro-panel-title">Find the track. Let the room shift with it.</div>
                <p className="intro-panel-copy">High-quality covers, section-aware visuals, smoother synced lyrics, and a cleaner path into the songs you actually meant to play.</p>
                <div className="intro-chip-row">
                  <span>accurate matching</span>
                  <span>live sync</span>
                  <span>cinematic playback</span>
                </div>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div id="yt-player-wrap" className={`yt-bg ${videoBg && ytVideoId && ytReady ? 'active' : ''}`}>
        <div id="yt-player" />
      </div>

      <div className={`bg ${videoBg && ytVideoId && ytReady ? 'bg-dimmed' : ''}`}>
        <AnimatePresence>
          {albumArt && (
            <motion.div key={albumArt} className="art-bg" style={{ backgroundImage: `url(${albumArt})` }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 4.0, ease: 'easeInOut' }}
            />
          )}
        </AnimatePresence>
        {/* Mesh-gradient base — static colour blobs derived from album palette */}
        <div className="mesh-base" />

        {/* Lightweight WebGL Particles — the only animated layer */}
        <div style={{ position: 'absolute', inset: 0, opacity: 0.7, pointerEvents: 'none', zIndex: 1 }}>
          <Particles
            particleCount={80}
            particleSpread={10}
            speed={0.4}
            particleColors={["#ffffff", "#eeddff", "#ddeeff"]}
            moveParticlesOnHover={false}
            alphaParticles
            particleBaseSize={40}
            sizeRandomness={2}
            cameraDistance={20}
            disableRotation
          />
        </div>

        {/* Chorus glow overlay — pure CSS opacity transition, zero cost when hidden */}
        <div className="chorus-glow-overlay" />

        {/* Floating particles for chorus mode — pure CSS, zero GPU cost */}
        <div className="chorus-particles" aria-hidden="true">
          <div className="chorus-particle" />
          <div className="chorus-particle" />
          <div className="chorus-particle" />
          <div className="chorus-particle" />
          <div className="chorus-particle" />
        </div>

        {/* Beat-reactive ambient glow — synced to BPM/energy from audio analyzer */}
        <BeatReactiveBackground
          bpm={bpm}
          energy={energy}
          beatIntensity={beatIntensity}
          isPlaying={isPlaying}
          palette={beatPalette}
        />

        <div className="vignette" />
        {/* Cinematic film grain — subtle noise texture over the whole scene */}
        <div className="grain-overlay" aria-hidden="true" />
      </div>

      {/* ChorusRipple burst rings — triggers on chorus entry */}
      <ChorusRipple isChorus={isChorus} />

      {/* ClickSpark canvas — fixed, captures spark bursts on lyric tap */}
      <canvas
        ref={sparkCanvasRef}
        style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999 }}
        width={window.innerWidth}
        height={window.innerHeight}
        aria-hidden="true"
      />

      <AnimatePresence>
        {revealPhase === 'cover' && albumArt && song && (
          <motion.div className="cover-reveal"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.35 } }} transition={{ duration: 0.3 }}
            onClick={() => { clearTimeout(revealTimerRef.current); setRevealPhase('playing'); }}
          >
            <motion.img src={albumArt} alt="" className="cover-reveal-img"
              initial={{ scale: 0.62, opacity: 0, y: 40, rotate: -5 }}
              animate={{ scale: 1, opacity: 1, y: 0, rotate: 0 }}
              exit={{ scale: 0.07, opacity: 0, x: 'calc(-50vw + 60px)', y: 'calc(-50vh + 72px)', rotate: 3, transition: { duration: 0.52, ease: [0.4, 0, 0.2, 1] } }}
              transition={{ type: 'spring', stiffness: 160, damping: 18, delay: 0.08 }}
            />
            <motion.div className="cover-reveal-info"
              initial={{ y: 28, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
              exit={{ y: -12, opacity: 0, transition: { duration: 0.2 } }}
              transition={{ delay: 0.22, duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="cover-reveal-title">{song.trackName}</div>
              <div className="cover-reveal-artist">{song.artistName}</div>
            </motion.div>
            <motion.div className="cover-reveal-tap"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }} transition={{ delay: 1.1, duration: 0.7 }}
            >tap to continue</motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showSearch && (
          <motion.div className="search-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            onClick={e => { if (e.target === e.currentTarget) setShowSearch(false); }}
            onKeyDown={e => { if (e.key === 'Escape') setShowSearch(false); }}
          >
            <motion.div className="search-overlay-inner"
              initial={{ opacity: 0, y: -28, scale: 0.93 }} animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 240, damping: 28, delay: 0.05 }}
            >{SearchBox}</motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">

        {/* Hero mounts immediately UNDER the intro veil, so when the veil
            fades there is no pop — its entrance settles before the reveal */}
        {!hasPlayer && (
          <motion.div key="hero" className="hero"
            initial={{ opacity: fromIntroRef.current ? 1 : 0 }} animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.97, filter: 'blur(6px)' }}
            transition={{ duration: 0.55, ease: [0.4, 0, 0.8, 1] }}
          >
            <motion.div className="hero-glow"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 1.8, ease: [0.16, 1, 0.3, 1] }}
            />
            <motion.div className="hero-logo"
              layoutId="brand-lockup"
              initial={{ opacity: 0, scale: 0.85, y: 10, filter: 'blur(6px)' }}
              animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ duration: fromIntroRef.current ? 0.65 : 0.45, ease: [0.16, 1, 0.3, 1], delay: fromIntroRef.current ? 0.05 : 0 }}
              onAnimationComplete={() => { fromIntroRef.current = false; }}
            ><Sparkles size={26} strokeWidth={1.2} /><span>aurora</span></motion.div>
            <motion.p className="hero-sub"
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: fromIntroRef.current ? 0.18 : 0.08, duration: 0.72, ease: [0.16, 1, 0.3, 1] }}
            >LYRICS, PERFECTLY IN SYNC.</motion.p>
            <motion.div className="hero-line"
              layoutId="brand-line"
              initial={{ scaleX: 0, opacity: 0 }} animate={{ scaleX: 1, opacity: 1 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
            />
            <motion.div className="hero-sw"
              initial={{ opacity: 0, y: 22, scale: 0.92 }} animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: fromIntroRef.current ? 0.26 : 0.15, type: 'spring', stiffness: 200, damping: 26 }}
            >{SearchBox}</motion.div>
            <motion.p className="hero-powered"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              transition={{ delay: 0.6, duration: 1.0 }}
            >Genius · LRCLib · YouTube</motion.p>
          </motion.div>
        )}

        {hasPlayer && (
          <motion.div key="player" className={`player${zenMode ? ' zen' : ''}`}
            initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }} transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* ── Minimal top bar ── */}
            <header className="hdr">
              <button className="back-btn" onClick={handleBack}><ArrowLeft size={15} /></button>
              <div className="logo logo-shiny"><Music2 size={15} strokeWidth={1.4} /><span>aurora</span></div>
              <motion.button
                className={`search-trigger ${zenMode ? 'search-trigger-active' : ''}`}
                onClick={() => setZenMode((value) => !value)}
                whileHover={{ scale: 1.12, rotate: zenMode ? -8 : 8 }}
                whileTap={{ scale: 0.88 }}
                transition={{ type: 'spring', stiffness: 280, damping: 20 }}
                aria-label={zenMode ? 'Show full player' : 'Hide player panel'}
                title={zenMode ? 'Show full player' : 'Hide player panel'}
              >
                {zenMode ? <Eye size={16} strokeWidth={2} /> : <EyeOff size={16} strokeWidth={2} />}
                <span className="strigger-ring" />
              </motion.button>
              <motion.button className="search-trigger"
                onClick={() => { setShowSearch(true); setTimeout(() => inputRef.current?.focus(), 80); }}
                whileHover={{ scale: 1.12, rotate: 10 }} whileTap={{ scale: 0.88 }}
                transition={{ type: 'spring', stiffness: 280, damping: 20 }} aria-label="Search"
              ><Search size={16} strokeWidth={2} /><span className="strigger-ring" /></motion.button>
            </header>

            <AnimatePresence>
              {showRecommendations && song && (
                <motion.div
                  className="recommend-overlay"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <motion.div
                    className="recommend-panel"
                    initial={{ opacity: 0, y: 24, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 16, scale: 0.98 }}
                    transition={{ type: 'spring', stiffness: 180, damping: 24 }}
                  >
                    <div className="recommend-kicker">Up Next</div>
                    <div className="recommend-title">More from this vibe</div>
                    <div className="recommend-subtitle">
                      {song.artistName} finished. Pick the next track.
                    </div>
                    <div className="recommend-actions">
                      <button
                        className="recommend-action-btn"
                        onClick={() => {
                          setShowRecommendations(false);
                          seekTo(0);
                          setIsPlaying(true);
                        }}
                      >
                        Replay
                      </button>
                      <button className="recommend-action-btn" onClick={() => setShowRecommendations(false)}>
                        Close
                      </button>
                    </div>
                    <div className="recommend-grid">
                      {isRecommendationsLoading && (
                        <div className="recommend-empty">Finding similar songs…</div>
                      )}
                      {!isRecommendationsLoading && recommendations.length === 0 && (
                        <div className="recommend-empty">No recommendations yet.</div>
                      )}
                      {!isRecommendationsLoading && recommendations.map((track, index) => (
                        <motion.button
                          key={`${track.artistName}-${track.trackName}-${index}`}
                          className="recommend-card"
                          onClick={() => loadTrack(track)}
                          initial={{ opacity: 0, y: 12 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: index * 0.03, duration: 0.22 }}
                        >
                          {track.art ? (
                            <img className="recommend-art" src={track.art} alt="" />
                          ) : (
                            <span className="recommend-art recommend-art-fallback"><Music2 size={18} /></span>
                          )}
                          <span className="recommend-card-copy">
                            <span className="recommend-card-title">{track.trackName}</span>
                            <span className="recommend-card-artist">{track.artistName}</span>
                          </span>
                        </motion.button>
                      ))}
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Apple Music-style split layout ── */}
            <div className="player-body">
              {/* LEFT PANEL: Album art + meta + controls */}
              <div className={`left-panel${zenMode ? ' zen-hide' : ''}`}>
                <AnimatePresence>
                  {albumArt && song && revealPhase === 'playing' && (
                    <motion.img key={albumArt} src={albumArt} alt={song.trackName} className="lp-art"
                      initial={{ opacity: 0, scale: 0.85, y: 20 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ type: 'spring', stiffness: 120, damping: 20, delay: 0.05 }}
                    />
                  )}
                </AnimatePresence>
                {song && (
                  <div className="lp-meta">
                    <div className="lp-artist">{song.artistName}</div>
                    <div className="lp-title"><GlitchText text={song.trackName} /></div>
                    <div className="lp-badges">
                      {hasRichSync && <span className="rs-badge" title="Word-level sync">W</span>}
                      {ytVideoId && ytReady && <span className="yt-badge">YT</span>}
                    </div>
                  </div>
                )}

                {/* Seek bar */}
                <div className="lp-seek">
                  <div className="track" ref={seekBarRef}
                    onMouseDown={handleSeekStart} onTouchStart={handleSeekStart}
                    style={{ cursor: song ? 'pointer' : 'default', touchAction: 'none' }}
                  >
                    <div className="tfill" ref={seekFillRef} />
                    <div className="tthumb" ref={seekThumbRef} />
                  </div>
                  <div className="lp-times">
                    <span className="tc" ref={curTimeDisplayRef}>{fmt(0)}</span>
                    <span className="tc">{fmt(duration)}</span>
                  </div>
                </div>

                {/* Controls */}
                <div className="lp-controls">
                  <button className="ico-btn" onClick={handleReset}><RotateCcw size={18} /></button>
                  <MagneticBtn strength={0.32}>
                  <motion.button className={`play-btn${isChorus ? ' play-btn-chorus' : ''}`}
                    onClick={() => {
                      if (!song || revealPhase !== 'playing') return;
                      setShowRecommendations(false);
                      setIsPlaying(p => !p);
                    }}
                    disabled={!song || revealPhase !== 'playing'}
                    whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }}
                  >
                    <AnimatePresence mode="wait">
                      {isPlaying
                        ? <motion.span key="pa" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} transition={{ duration: 0.11 }}><Pause size={24} fill="white" /></motion.span>
                        : <motion.span key="pl" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} transition={{ duration: 0.11 }}><Play size={24} fill="white" style={{ marginLeft: 3 }} /></motion.span>
                      }
                    </AnimatePresence>
                  </motion.button>
                  </MagneticBtn>
                  <button
                    className={`ico-btn ${videoBg ? 'ico-btn-active' : ''}`}
                    onClick={() => setVideoBg((v) => !v)}
                    title={isVideoLoading ? 'Loading Video Background' : 'Video Background'}
                  >
                    {isVideoLoading ? <Loader size={18} className="spin" /> : <Film size={18} />}
                  </button>
                </div>

                {/* Lyrics offset adjustment */}
                <div className="lp-offset">
                  <button className="offset-btn" onClick={() => setLyricsOffset(o => +(o - 0.1).toFixed(1))} title="Lyrics later (−0.1s)">
                    <Minus size={12} />
                  </button>
                  <span className="offset-label" onClick={() => setLyricsOffset(0)} title="Reset offset">
                    {lyricsOffset === 0 ? 'SYNC' : `${lyricsOffset > 0 ? '+' : ''}${lyricsOffset.toFixed(1)}s`}
                  </span>
                  <button className="offset-btn" onClick={() => setLyricsOffset(o => +(o + 0.1).toFixed(1))} title="Lyrics earlier (+0.1s)">
                    <Plus size={12} />
                  </button>
                </div>
              </div>

              {/* RIGHT PANEL: Lyrics */}
              <div className="lyric-area">
                <AnimatePresence>
                  {showMelody && (
                    <motion.div className="melody-overlay" key="waveform"
                      initial={{ opacity: 0, scale: 0.92, y: 12 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, y: -8 }}
                      transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
                    ><WaveformVisualizer isChorus={isChorus} /></motion.div>
                  )}
                  {showCountdown && !showMelody && (
                    <motion.div className="melody-overlay" key="countdown"
                      initial={{ opacity: 0, scale: 0.85 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.90 }}
                      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                    ><CountdownDots /></motion.div>
                  )}
                </AnimatePresence>

                <div className="lyric-scroll" ref={lyricsRef}>
                  {isLoading && (
                    <div className="empty"><span className="pulse-ring" /><span className="load-lbl">Loading lyrics…</span></div>
                  )}
                  {!isLoading && (
                    <div className="lyric-inner">
                      {lyrics.map((line, i) => {
                        const dist = Math.abs(i - effectiveActiveIndex);
                        const isActive = i === effectiveActiveIndex;
                        const isUpcoming = showCountdown && i === activeIndex + 1;
                        const lenBucket = getLyricLenBucket(line.text);
                        const fitMultiplier = getLyricFitMultiplier(line.text, isActive, !!line.isGap);
                        return (
                          <div
                            key={`${song?.id}-${i}`}
                            ref={el => { lineRefs.current[i] = el; }}
                            className={`lyr ${distClass(dist, isActive)}${isUpcoming ? ' l-upcoming' : ''}${line.isGap ? ' l-gap' : ''} lyr-reveal`}
                            data-len={lenBucket}
                            data-time={fmt(line.time)}
                            data-text={line.text}
                            data-idx={i}
                            style={{ 
                              '--lyric-fit': fitMultiplier,
                              '--reveal-delay': `${Math.min(i * 0.03, 0.6)}s`,
                              animationDelay: `${Math.min(i * 0.03, 0.6)}s`
                            }}
                            onClick={(e) => {
                              if (line.isGap) return;
                              fireSpark(e.clientX, e.clientY);
                              setShowRecommendations(false);
                              seekTo(Math.max(0, line.time - lyricsOffset));
                              setIsPlaying(true);
                            }}
                          >
                            {renderLyricText(line, i)}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    </LayoutGroup>
    </MotionConfig>
  );
}