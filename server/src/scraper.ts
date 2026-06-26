// ─── Aurora Omniscient Scraper Engine v3 ─────────────────────────────────────
// Multi-Layer Failover with RapidAPI Integration
// Search: Genius RapidAPI → Genius AJAX → LRCLib
// Lyrics: GeniusLyrics RapidAPI → Musixmatch RapidAPI → Genius Scrape → Timestamp Lyrics → LRCLib

import axios from 'axios';
import * as cheerio from 'cheerio';
import type { StructuredLyrics, LyricsSection, SectionType, ScraperResult } from './types.js';

const RAPIDAPI_KEY = () => process.env.RAPIDAPI_KEY || '';

// ─── User-Agent Rotation Pool ───────────────────────────────────────────────
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
];

const randomUA = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

const pickBestArtUrl = (song: any) =>
  song.song_art_image_url
  || song.header_image_url
  || song.image
  || song.song_art_image_thumbnail_url
  || song.header_image_thumbnail_url
  || song.thumbnail
  || null;

const BROWSER_HEADERS = () => ({
  'User-Agent': randomUA(),
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,el;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer': 'https://www.google.com/',
  'DNT': '1',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'cross-site',
  'Sec-Fetch-User': '?1',
  'Cache-Control': 'max-age=0',
});

// ─── Section Parser ─────────────────────────────────────────────────────────
const SECTION_RE = /^\[([^\]]+)\]$/;
const SECTION_TYPE_MAP: Record<string, SectionType> = {
  'chorus': 'chorus',
  'refrain': 'chorus',
  'refrão': 'chorus',
  'estribillo': 'chorus',
  'hook': 'hook',
  'verse': 'verse',
  'couplet': 'verse',
  'strophe': 'verse',
  'pre-chorus': 'pre-chorus',
  'prechorus': 'pre-chorus',
  'pre chorus': 'pre-chorus',
  'build': 'pre-chorus',
  'build-up': 'pre-chorus',
  'bridge': 'bridge',
  'pont': 'bridge',
  'puente': 'bridge',
  'intro': 'intro',
  'outro': 'outro',
  'interlude': 'interlude',
  'instrumental': 'interlude',
  'break': 'interlude',
  'post-chorus': 'post-chorus',
  'postchorus': 'post-chorus',
  'post chorus': 'post-chorus',
  'drop': 'chorus',
  'beat drop': 'chorus',
};

const SECTION_KEYS_SORTED = Object.keys(SECTION_TYPE_MAP).sort((a, b) => b.length - a.length);

function classifySection(label: string): SectionType {
  const lower = label.toLowerCase().replace(/\s*\d+\s*/g, '').trim();
  for (const key of SECTION_KEYS_SORTED) {
    if (lower.startsWith(key) || lower.includes(key)) return SECTION_TYPE_MAP[key];
  }
  return 'unknown';
}

export function parseSections(rawText: string): LyricsSection[] {
  const lines = rawText.split('\n');
  const sections: LyricsSection[] = [];
  let currentSection: LyricsSection | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const headerMatch = trimmed.match(SECTION_RE);
    if (headerMatch) {
      if (currentSection && currentSection.content.length > 0) {
        sections.push(currentSection);
      }
      const label = headerMatch[1];
      currentSection = {
        type: classifySection(label),
        label,
        content: [],
      };
    } else {
      if (!currentSection) {
        currentSection = { type: 'verse', label: 'Verse', content: [] };
      }
      currentSection.content.push(trimmed);
    }
  }

  if (currentSection && currentSection.content.length > 0) {
    sections.push(currentSection);
  }

  return sections;
}

// ─── Greedy Text Extractor (Cheerio) ────────────────────────────────────────
function extractText($: cheerio.CheerioAPI, el: any): string {
  let result = '';
  $(el).contents().each((_: number, node: any) => {
    if (node.type === 'tag' && node.name === 'br') {
      result += '\n';
    } else if (node.type === 'text') {
      result += $(node).text();
    } else if (node.type === 'tag') {
      result += extractText($, node);
    }
  });
  return result;
}

function greedyExtract($: cheerio.CheerioAPI): string {
  let fullText = '';
  $('[class^="Lyrics__Container"]').each((_: number, el: any) => {
    fullText += extractText($, el) + '\n';
  });

  if (!fullText.trim()) {
    $('[data-lyrics-container="true"]').each((_: number, el: any) => {
      fullText += extractText($, el) + '\n';
    });
  }

  if (!fullText.trim()) {
    const selectors = ['.lyrics', '#lyrics-root', '[class*="lyrics"]'];
    for (const sel of selectors) {
      $(sel).each((_: number, el: any) => {
        fullText += extractText($, el) + '\n';
      });
      if (fullText.trim()) break;
    }
  }

  return cleanLyrics(fullText);
}

function cleanLyrics(raw: string): string {
  let text = raw
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();

  const firstHeaderIdx = text.search(/^\[[A-Z][^\]]*\]/m);
  if (firstHeaderIdx > 0) {
    text = text.substring(firstHeaderIdx).trim();
  }

  return text;
}

function decodeEscapedGeniusString(value: string): string {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\//g, '/')
    .replace(/\\\\/g, '\\')
    .replace(/\\u003C/g, '<')
    .replace(/\\u003E/g, '>')
    .replace(/\\u0026/g, '&')
    .replace(/\\u2019/g, '’')
    .replace(/\\u2018/g, '‘')
    .replace(/\\u201C/g, '“')
    .replace(/\\u201D/g, '”');
}

function htmlFragmentToLyricsText(fragment: string): string {
  const $ = cheerio.load(`<div id="aurora-lyrics-root">${fragment}</div>`);
  const root = $('#aurora-lyrics-root');
  const extracted = extractText($, root);
  return cleanLyrics(
    extracted
      .replace(/\bEmbed\b/g, '')
      .replace(/\n{3,}/g, '\n\n')
  );
}

function extractPreloadedStateLyrics(html: string): string | null {
  const preloadedMatch = html.match(/lyricsData\\":\{[\s\S]*?body\\":\{\\?"html\\?":"([\s\S]*?)",\\?"children\\?":/);
  if (preloadedMatch?.[1]) {
    const decoded = decodeEscapedGeniusString(preloadedMatch[1]);
    const text = htmlFragmentToLyricsText(decoded);
    if (text.length > 20) return text;
  }

  const bodyHtmlMatch = html.match(/"lyricsData":\{[\s\S]*?"body":\{"html":"([\s\S]*?)","children":/);
  if (bodyHtmlMatch?.[1]) {
    const decoded = decodeEscapedGeniusString(bodyHtmlMatch[1]);
    const text = htmlFragmentToLyricsText(decoded);
    if (text.length > 20) return text;
  }

  return null;
}

// ─── Normalize for matching ─────────────────────────────────────────────────
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();

const searchScore = (query: string, item: any) => {
  const q = norm(query);
  const artist = norm(item.artist || item.artistName || '');
  const title = norm(item.title || item.trackName || '');
  const combined = `${artist} ${title}`.trim();
  let score = 0;
  if (combined === q) score += 120;
  if (artist && q.includes(artist)) score += 40;
  if (title && q.includes(title)) score += 52;
  if (combined && (combined.includes(q) || q.includes(combined))) score += 42;
  if (item.url) score += 6;
  if (item.art) score += 4;
  if (item.hasSynced) score += 8;
  if (item.duration && item.duration > 20) score += 6;
  if (!item.duration) score -= 8;
  return score;
};

const dedupeSearchResults = (query: string, results: any[]) => {
  const merged = new Map<string, any>();
  for (const item of results) {
    const key = `${norm(item.artist || item.artistName || '')}|${norm(item.title || item.trackName || '')}`;
    if (!key || key === '|') continue;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, item);
      continue;
    }
    merged.set(key, {
      ...existing,
      ...item,
      art: existing.art || item.art || null,
      url: existing.url || item.url || null,
      duration: existing.duration || item.duration || 0,
      hasSynced: existing.hasSynced || item.hasSynced || false,
      score: Math.max(existing.score || 0, item.score || 0, searchScore(query, existing), searchScore(query, item)),
    });
  }

  return [...merged.values()]
    .map((item) => ({ ...item, score: item.score || searchScore(query, item) }))
    .sort((a, b) => b.score - a.score);
};

// ═══════════════════════════════════════════════════════════════════════════════
// SEARCH LAYERS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Search Layer 1: Genius Song Lyrics RapidAPI ────────────────────────────
// Best source: returns correct artwork, song URL, artist info
async function searchGeniusRapidAPI(query: string): Promise<any[]> {
  const key = RAPIDAPI_KEY();
  if (!key) return [];

  try {
    const { data } = await axios.get('https://genius-song-lyrics1.p.rapidapi.com/search/', {
      params: { q: query, per_page: 10, page: 1 },
      headers: {
        'x-rapidapi-host': 'genius-song-lyrics1.p.rapidapi.com',
        'x-rapidapi-key': key,
      },
      timeout: 5000,
    });

    const hits = data?.hits || data?.response?.hits || [];
    if (!hits.length) return [];

    return hits.map((h: any) => {
      const song = h.result || h;
      return {
        title: song.title || song.full_title || '',
        artist: song.primary_artist?.name || song.artist_names || '',
        art: pickBestArtUrl(song),
        url: song.url || null,
        id: song.id || 0,
      };
    }).filter((r: any) => r.title && r.artist);
  } catch (err: any) {
    console.log(`[SEARCH] Genius RapidAPI failed: ${err.message}`);
    return [];
  }
}

// ─── Search Layer 2: GeniusLyrics-API RapidAPI ──────────────────────────────
async function searchGeniusLyricsAPI(query: string): Promise<any[]> {
  const key = RAPIDAPI_KEY();
  if (!key) return [];

  try {
    const { data } = await axios.get('https://geniuslyrics-api.p.rapidapi.com/search_song', {
      params: { q: query },
      headers: {
        'x-rapidapi-host': 'geniuslyrics-api.p.rapidapi.com',
        'x-rapidapi-key': key,
      },
      timeout: 5000,
    });

    if (!data || !Array.isArray(data)) return [];

    return data.slice(0, 10).map((song: any) => ({
      title: song.title || '',
      artist: song.artist || song.primary_artist?.name || '',
      art: pickBestArtUrl(song),
      url: song.url || null,
      id: song.id || 0,
    })).filter((r: any) => r.title && r.artist);
  } catch (err: any) {
    console.log(`[SEARCH] GeniusLyrics-API failed: ${err.message}`);
    return [];
  }
}

// ─── Search Layer 3: Genius Official API (if token exists) ──────────────────
async function searchGeniusOfficialAPI(query: string): Promise<any[]> {
  const token = process.env.GENIUS_ACCESS_TOKEN;
  if (!token) return [];

  try {
    const { data } = await axios.get('https://api.genius.com/search', {
      params: { q: query },
      headers: { Authorization: `Bearer ${token}` },
      timeout: 4000,
    });
    const hits = data?.response?.hits;
    if (!hits?.length) return [];

    return hits.map((h: any) => ({
      title: h.result.title,
      artist: h.result.primary_artist?.name,
      art: pickBestArtUrl(h.result),
      url: h.result.url,
      id: h.result.id,
    }));
  } catch {
    return [];
  }
}

// ─── Search Layer 4: Genius AJAX Fallback ───────────────────────────────────
async function searchGeniusAJAX(query: string): Promise<any[]> {
  try {
    const { data } = await axios.get(
      `https://genius.com/api/search/multi?q=${encodeURIComponent(query)}`,
      {
        headers: { 'User-Agent': randomUA(), 'Accept': 'application/json, text/plain, */*' },
        timeout: 4000,
      }
    );
    if (data?.response?.sections) {
      for (const section of data.response.sections) {
        if (section.type === 'song' && section.hits?.length > 0) {
          return section.hits.map((h: any) => ({
            title: h.result.title,
            artist: h.result.primary_artist?.name,
            art: pickBestArtUrl(h.result),
            url: h.result.url,
            id: h.result.id,
          }));
        }
      }
    }
    return [];
  } catch {
    return [];
  }
}

// ─── Search Layer 5: LRCLib ─────────────────────────────────────────────────
async function searchLRCLibResults(query: string): Promise<any[]> {
  try {
    const { data: lrcResults } = await axios.get(
      `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`,
      { timeout: 5000 }
    );
    const seen = new Set<string>();
    const results: any[] = [];
    for (const t of lrcResults) {
      const key = `${t.artistName}|${t.trackName}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        title: t.trackName,
        artist: t.artistName,
        art: null,
        url: null,
        id: t.id,
        lrcId: t.id,
        duration: t.duration,
        hasSynced: !!t.syncedLyrics,
      });
      if (results.length >= 12) break;
    }
    return results;
  } catch {
    return [];
  }
}

async function searchGeniusDirectPages(query: string): Promise<any[]> {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 6) return [];

  const attempts: Array<{ artist: string; title: string }> = [];
  for (let split = 1; split < tokens.length; split++) {
    const artistLeft = tokens.slice(0, split).join(' ');
    const titleRight = tokens.slice(split).join(' ');
    const titleLeft = tokens.slice(0, split).join(' ');
    const artistRight = tokens.slice(split).join(' ');

    attempts.push({ artist: artistLeft, title: titleRight });
    attempts.push({ artist: artistRight, title: titleLeft });
  }

  const unique = new Map<string, { artist: string; title: string }>();
  for (const attempt of attempts) {
    const key = `${norm(attempt.artist)}|${norm(attempt.title)}`;
    if (!unique.has(key)) unique.set(key, attempt);
  }

  const checks = [...unique.values()].slice(0, 8);
  const pages = await Promise.all(checks.map(async ({ artist, title }) => {
    const url = buildGeniusUrl(artist, title);
    try {
      const { data, status } = await axios.get(url, {
        headers: { 'User-Agent': randomUA(), 'Accept': 'text/html,application/xhtml+xml' },
        timeout: 4000,
        maxRedirects: 2,
        validateStatus: () => true,
      });
      if (status !== 200 || typeof data !== 'string') return null;
      const hasLyrics = data.includes('lyricsData') || data.includes('Lyrics__Container') || data.includes('data-lyrics-container');
      if (!hasLyrics) return null;
      const titleMatch = data.match(/<meta property="og:title" content="([^"]+)"/i);
      const imageMatch = data.match(/<meta property="og:image" content="([^"]+)"/i);
      const ogTitle = titleMatch?.[1] || `${artist} - ${title}`;
      const cleanTitle = ogTitle.replace(/\s+Lyrics(?:\s*\|.*)?$/i, '').trim();
      return {
        title,
        artist,
        art: imageMatch?.[1] || null,
        url,
        id: url,
        source: 'genius-direct',
        score: searchScore(query, { artist, title: cleanTitle, url, art: imageMatch?.[1] || null }) + 18,
      };
    } catch {
      return null;
    }
  }));

  return pages.filter(Boolean) as any[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// LYRICS LAYERS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Lyrics Layer 1: GeniusLyrics-API RapidAPI (pre-scraped) ────────────────
// This API scrapes Genius server-side — no Puppeteer needed!
async function fetchLyricsGeniusRapidAPI(artist: string, title: string): Promise<string | null> {
  const key = RAPIDAPI_KEY();
  if (!key) return null;

  try {
    // First search for the song to get its ID
    const { data: searchData } = await axios.get('https://geniuslyrics-api.p.rapidapi.com/search_song', {
      params: { q: `${artist} ${title}` },
      headers: {
        'x-rapidapi-host': 'geniuslyrics-api.p.rapidapi.com',
        'x-rapidapi-key': key,
      },
      timeout: 5000,
    });

    if (!searchData || !Array.isArray(searchData) || searchData.length === 0) return null;

    // Find best match
    const nArtist = norm(artist);
    const nTitle = norm(title);
    let bestSong = searchData[0];
    for (const song of searchData) {
      const sArtist = norm(song.artist || song.primary_artist?.name || '');
      const sTitle = norm(song.title || '');
      if ((sArtist.includes(nArtist) || nArtist.includes(sArtist)) &&
          (sTitle.includes(nTitle) || nTitle.includes(sTitle))) {
        bestSong = song;
        break;
      }
    }

    const songId = bestSong.id;
    if (!songId) return null;

    // Now get the lyrics
    const { data: lyricsData } = await axios.get('https://geniuslyrics-api.p.rapidapi.com/get_lyrics', {
      params: { id: songId },
      headers: {
        'x-rapidapi-host': 'geniuslyrics-api.p.rapidapi.com',
        'x-rapidapi-key': key,
      },
      timeout: 8000,
    });

    // The API may return lyrics in different formats
    let lyrics = '';
    if (typeof lyricsData === 'string') {
      lyrics = lyricsData;
    } else if (lyricsData?.lyrics) {
      lyrics = typeof lyricsData.lyrics === 'string' ? lyricsData.lyrics : '';
    } else if (lyricsData?.plain) {
      lyrics = lyricsData.plain;
    }

    if (lyrics && lyrics.length > 20) {
      return cleanLyrics(lyrics);
    }
    return null;
  } catch (err: any) {
    console.log(`[LYRICS] GeniusLyrics-API failed: ${err.message}`);
    return null;
  }
}

// ─── Lyrics Layer 2: Musixmatch Song Lyrics API RapidAPI ────────────────────
async function fetchLyricsMusixmatchRapidAPI(artist: string, title: string): Promise<string | null> {
  const key = RAPIDAPI_KEY();
  if (!key) return null;

  try {
    const { data } = await axios.get(
      `https://musixmatch-song-lyrics-api.p.rapidapi.com/lyrics/${encodeURIComponent(artist)}/${encodeURIComponent(title)}/`,
      {
        headers: {
          'x-rapidapi-host': 'musixmatch-song-lyrics-api.p.rapidapi.com',
          'x-rapidapi-key': key,
          'Content-Type': 'application/json',
        },
        timeout: 6000,
      }
    );

    // Extract lyrics from response
    let lyrics = '';
    if (typeof data === 'string') {
      lyrics = data;
    } else if (data?.lyrics) {
      lyrics = typeof data.lyrics === 'string' ? data.lyrics : '';
    } else if (data?.message?.body?.lyrics?.lyrics_body) {
      lyrics = data.message.body.lyrics.lyrics_body;
    }

    if (lyrics && lyrics.length > 20) {
      // Remove Musixmatch watermark if present
      lyrics = lyrics.replace(/\*{7}[\s\S]*$/m, '').trim();
      return cleanLyrics(lyrics);
    }
    return null;
  } catch (err: any) {
    console.log(`[LYRICS] Musixmatch RapidAPI failed: ${err.message}`);
    return null;
  }
}

// ─── Lyrics Layer 3: Musixmatch Lyrics Songs RapidAPI ───────────────────────
async function fetchLyricsMusixmatchSongs(artist: string, title: string): Promise<{ text: string; synced?: any[] } | null> {
  const key = RAPIDAPI_KEY();
  if (!key) return null;

  try {
    const { data } = await axios.get(
      'https://musixmatch-lyrics-songs.p.rapidapi.com/songs/lyrics',
      {
        params: { t: title, a: artist, d: '' },
        headers: {
          'x-rapidapi-host': 'musixmatch-lyrics-songs.p.rapidapi.com',
          'x-rapidapi-key': key,
          'Content-Type': 'application/json',
        },
        timeout: 6000,
      }
    );

    if (!data?.success || !data?.lyrics) return null;

    // This API returns synced lyrics with timestamps
    const lyrics = data.lyrics;
    if (Array.isArray(lyrics) && lyrics.length > 0) {
      // Build plain text and synced data
      const lines = lyrics.map((l: any) => l.text || '').filter((t: string) => t.trim());
      const plainText = lines.join('\n');
      if (plainText.length > 20) {
        return {
          text: plainText,
          synced: lyrics, // Contains { text, time: { total, minutes, seconds, hundredths } }
        };
      }
    }
    return null;
  } catch (err: any) {
    console.log(`[LYRICS] Musixmatch Songs RapidAPI failed: ${err.message}`);
    return null;
  }
}

// ─── Lyrics Layer 4: Timestamp Lyrics RapidAPI ──────────────────────────────
async function fetchTimestampLyrics(songName: string): Promise<{ text: string; syncedLrc?: string } | null> {
  const key = RAPIDAPI_KEY();
  if (!key) return null;

  try {
    const { data } = await axios.get(
      'https://timestamp-lyrics.p.rapidapi.com/extract-lyrics',
      {
        params: { name: songName },
        headers: {
          'x-rapidapi-host': 'timestamp-lyrics.p.rapidapi.com',
          'x-rapidapi-key': key,
          'Content-Type': 'application/json',
        },
        timeout: 8000,
      }
    );

    if (!data) return null;

    // May return synced lyrics with timestamps
    let text = '';
    let syncedLrc = '';

    if (typeof data === 'string') {
      text = data;
    } else if (data.lyrics) {
      if (typeof data.lyrics === 'string') {
        text = data.lyrics;
      } else if (Array.isArray(data.lyrics)) {
        // Timestamped array format
        const lines: string[] = [];
        const lrcLines: string[] = [];
        for (const entry of data.lyrics) {
          const t = entry.text || entry.line || '';
          const time = entry.time || entry.timestamp || 0;
          if (t.trim()) {
            lines.push(t);
            if (time || time === 0) {
              const totalSec = typeof time === 'number' ? time : parseFloat(time);
              const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
              const ss = String(Math.floor(totalSec % 60)).padStart(2, '0');
              const cs = String(Math.floor((totalSec % 1) * 100)).padStart(2, '0');
              lrcLines.push(`[${mm}:${ss}.${cs}]${t}`);
            }
          }
        }
        text = lines.join('\n');
        if (lrcLines.length > 0) syncedLrc = lrcLines.join('\n');
      }
    } else if (data.syncedLyrics || data.synced_lyrics) {
      syncedLrc = data.syncedLyrics || data.synced_lyrics;
      text = syncedLrc.replace(/\[\d{2}:\d{2}\.\d{2,3}\]/g, '');
    } else if (data.plainLyrics || data.plain_lyrics) {
      text = data.plainLyrics || data.plain_lyrics;
    }

    if (text && text.length > 20) {
      return { text: cleanLyrics(text), syncedLrc: syncedLrc || undefined };
    }
    return null;
  } catch (err: any) {
    console.log(`[LYRICS] Timestamp Lyrics RapidAPI failed: ${err.message}`);
    return null;
  }
}

// ─── Genius URL Search (for scraping) ───────────────────────────────────────
async function findGeniusUrl(artist: string, title: string): Promise<{ url: string; id: number } | null> {
  // Try Genius Official API
  const token = process.env.GENIUS_ACCESS_TOKEN;
  if (token) {
    try {
      const query = `${artist} ${title}`;
      const { data } = await axios.get('https://api.genius.com/search', {
        params: { q: query },
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5000,
      });
      const hits = data?.response?.hits;
      if (hits?.length) {
        const nArtist = norm(artist);
        const nTitle = norm(title);
        for (const hit of hits) {
          const song = hit.result;
          const hArtist = norm(song.primary_artist?.name || '');
          const hTitle = norm(song.title || '');
          if ((hArtist.includes(nArtist) || nArtist.includes(hArtist)) &&
              (hTitle.includes(nTitle) || nTitle.includes(hTitle))) {
            return { url: song.url, id: song.id };
          }
        }
        return { url: hits[0].result.url, id: hits[0].result.id };
      }
    } catch {}
  }

  // Try AJAX fallback
  try {
    const query = `${artist} ${title}`;
    const { data } = await axios.get(
      `https://genius.com/api/search/multi?q=${encodeURIComponent(query)}`,
      {
        headers: { 'User-Agent': randomUA(), 'Accept': 'application/json, text/plain, */*' },
        timeout: 4000,
      }
    );
    if (data?.response?.sections) {
      for (const section of data.response.sections) {
        if (section.type === 'song' && section.hits?.length > 0) {
          const song = section.hits[0].result;
          return { url: song.url, id: song.id };
        }
      }
    }
  } catch {}

  return null;
}

// ─── Genius Cheerio Scrape ──────────────────────────────────────────────────
async function scrapeCheerio(url: string): Promise<string | null> {
  try {
    const { data, status } = await axios.get(url, {
      headers: BROWSER_HEADERS(),
      timeout: 8000,
      maxRedirects: 3,
      validateStatus: (s) => s < 500,
    });
    if (status === 403 || status === 429) return null;
    const preloadedText = extractPreloadedStateLyrics(String(data));
    if (preloadedText) return preloadedText;
    const $ = cheerio.load(data);
    const text = greedyExtract($);
    return text || null;
  } catch {
    return null;
  }
}

// ─── Puppeteer Stealth ──────────────────────────────────────────────────────
let puppeteerAvailable: boolean | null = null;

async function scrapePuppeteer(url: string): Promise<string | null> {
  if (puppeteerAvailable === false) return null;

  try {
    const puppeteerExtra = await import('puppeteer-extra');
    const StealthPlugin = await import('puppeteer-extra-plugin-stealth');
    puppeteerAvailable = true;

    puppeteerExtra.default.use(StealthPlugin.default());

    const browser = await puppeteerExtra.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1920,1080'],
    });

    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent(randomUA());
      await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9', 'Referer': 'https://www.google.com/' });
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForSelector('[class^="Lyrics__Container"], [data-lyrics-container="true"]', { timeout: 8000 }).catch(() => {});
      const html = await page.content();
      const preloadedText = extractPreloadedStateLyrics(html);
      if (preloadedText) return preloadedText;
      const $ = cheerio.load(html);
      const text = greedyExtract($);
      return text || null;
    } finally {
      await browser.close();
    }
  } catch (err: any) {
    if (err?.code === 'MODULE_NOT_FOUND' || err?.code === 'ERR_MODULE_NOT_FOUND') {
      puppeteerAvailable = false;
      console.log('[AURORA] Puppeteer not installed — Layer disabled.');
    }
    return null;
  }
}

// ─── LRCLib (Final Fallback) ────────────────────────────────────────────────
async function searchLRCLib(artist: string, title: string): Promise<StructuredLyrics | null> {
  try {
    const { data } = await axios.get('https://lrclib.net/api/get', {
      params: { artist_name: artist, track_name: title },
      timeout: 5000,
    });

    if (data) {
      const rawText = data.plainLyrics || data.syncedLyrics?.replace(/\[\d{2}:\d{2}\.\d{2,3}\]/g, '') || '';
      if (rawText.length < 10) throw new Error('empty');
      const sections = parseSections(rawText);
      return {
        artist, title, sections, rawText,
        source: 'lrclib',
        syncedLrc: data.syncedLyrics || undefined,
        richSyncJson: data.richSyncLyrics || undefined,
        fetchedAt: Date.now(),
      };
    }
  } catch {}

  try {
    const { data: results } = await axios.get('https://lrclib.net/api/search', {
      params: { q: `${artist} ${title}` },
      timeout: 5000,
    });

    if (results?.length > 0) {
      const best = results[0];
      const rawText = best.plainLyrics || best.syncedLyrics?.replace(/\[\d{2}:\d{2}\.\d{2,3}\]/g, '') || '';
      if (rawText.length < 10) return null;
      const sections = parseSections(rawText);
      return {
        artist: best.artistName || artist,
        title: best.trackName || title,
        sections, rawText,
        source: 'lrclib',
        syncedLrc: best.syncedLyrics || undefined,
        richSyncJson: best.richSyncLyrics || undefined,
        fetchedAt: Date.now(),
      };
    }
  } catch {}

  return null;
}

// ─── Build Genius URL from artist + title ───────────────────────────────────
// Handles special characters, features, parentheses, etc.
// e.g. "The Weeknd" + "Starboy" -> "https://genius.com/The-weeknd-starboy-lyrics"
// e.g. "AC/DC" + "Back in Black" -> "https://genius.com/Ac-dc-back-in-black-lyrics"
// e.g. "Lumine (EDM)" + "Don't Worry" -> "https://genius.com/Lumine-edm-dont-worry-lyrics"
function buildGeniusUrl(artist: string, title: string): string {
  // Clean title: remove (feat. ...), (prod. ...), [Official ...] etc.
  let cleanTitle = title
    .replace(/\s*\((?:feat|ft|prod|official|music|lyric|audio|video|remix)\.?[^)]*\)/gi, '')
    .replace(/\s*\[(?:feat|ft|prod|official|music|lyric|audio|video|remix)\.?[^\]]*\]/gi, '')
    .trim();

  // Clean artist: expand parenthetical tags like "(EDM)" into the slug
  let cleanArtist = artist
    .replace(/\s*\(([^)]+)\)/g, ' $1')
    .trim();

  const slug = `${cleanArtist} ${cleanTitle}`
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/['']/g, '')         // don't -> dont, smart quotes
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `https://genius.com/${slug}-lyrics`;
}

// ─── Generate multiple Genius URL variants to maximise crawl hit-rate ────────
// Genius slugs sometimes differ from the obvious pattern (e.g. "The" removal,
// featured-artist parenthetical stripped from title, etc.).  We probe all
// plausible variants in parallel so that at least one lands.
function buildGeniusUrlVariants(artist: string, title: string): string[] {
  const variants = new Set<string>();

  // Variant 1: Standard
  variants.add(buildGeniusUrl(artist, title));

  // Variant 2: Artist without leading "The "
  const artistNoThe = artist.replace(/^the\s+/i, '').trim();
  if (artistNoThe && artistNoThe !== artist) {
    variants.add(buildGeniusUrl(artistNoThe, title));
  }

  // Variant 3: Title without featured artist "(feat. ...)" / "[ft. ...]"
  const titleNoFeat = title
    .replace(/\s*[\(\[](?:feat(?:uring)?|ft|with)\.?\s+[^\)\]]*/gi, '')
    .replace(/[\)\]]/g, '')
    .trim();
  if (titleNoFeat && titleNoFeat !== title) {
    variants.add(buildGeniusUrl(artist, titleNoFeat));
    if (artistNoThe !== artist) variants.add(buildGeniusUrl(artistNoThe, titleNoFeat));
  }

  // Variant 4: Title without any trailing parenthetical (e.g. "(Remastered 2011)")
  const titleNoParen = title.replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (titleNoParen && titleNoParen !== title && titleNoParen !== titleNoFeat) {
    variants.add(buildGeniusUrl(artist, titleNoParen));
  }

  // Variant 5: Title without bracket suffix "[...]"
  const titleNoBracket = title.replace(/\s*\[[^\]]*\]\s*$/, '').trim();
  if (titleNoBracket && titleNoBracket !== title && titleNoBracket !== titleNoParen) {
    variants.add(buildGeniusUrl(artist, titleNoBracket));
  }

  return [...variants];
}

// ─── Probe a Genius URL quickly (HEAD + minimal GET) ─────────────────────────
async function probeGeniusUrl(url: string): Promise<string | null> {
  try {
    const { data, status } = await axios.get(url, {
      headers: BROWSER_HEADERS(),
      timeout: 7000,
      maxRedirects: 3,
      validateStatus: () => true,
    });
    if (status !== 200 || typeof data !== 'string') return null;
    const hasLyrics =
      data.includes('lyricsData') ||
      data.includes('Lyrics__Container') ||
      data.includes('data-lyrics-container');
    if (!hasLyrics) return null;
    const preloaded = extractPreloadedStateLyrics(data);
    if (preloaded) return preloaded;
    const $ = cheerio.load(data);
    const text = greedyExtract($);
    return text || null;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════════════════

export class ScraperCoordinator {
  /**
   * Full multi-layer lyrics fetch with structured parsing.
   */
  async fetchLyrics(artist: string, title: string): Promise<ScraperResult> {
    let rawText: string | null = null;
    let source: StructuredLyrics['source'] = 'genius-cheerio';
    let syncedLrc: string | undefined;

    // ─── Layer 1: GeniusLyrics-API RapidAPI (pre-scraped, fastest) ────
    console.log(`[SCRAPER] Layer 1: GeniusLyrics-API for "${artist} - ${title}"`);
    rawText = await fetchLyricsGeniusRapidAPI(artist, title);
    if (rawText && rawText.length > 20) {
      source = 'genius-rapidapi';
      console.log(`[SCRAPER] Layer 1 → GeniusLyrics-API: ${rawText.length} chars`);
    } else {
      rawText = null;
    }

    // ─── Layer 2: Musixmatch Song Lyrics API ─────────────────────────
    if (!rawText) {
      console.log(`[SCRAPER] Layer 2: Musixmatch Song Lyrics API`);
      rawText = await fetchLyricsMusixmatchRapidAPI(artist, title);
      if (rawText && rawText.length > 20) {
        source = 'musixmatch-rapidapi';
        console.log(`[SCRAPER] Layer 2 → Musixmatch: ${rawText.length} chars`);
      } else {
        rawText = null;
      }
    }

    // ─── Layer 2b: Musixmatch Lyrics Songs (with synced timestamps) ──
    if (!rawText) {
      console.log(`[SCRAPER] Layer 2b: Musixmatch Lyrics Songs`);
      const mxResult = await fetchLyricsMusixmatchSongs(artist, title);
      if (mxResult && mxResult.text.length > 20) {
        rawText = mxResult.text;
        source = 'musixmatch-rapidapi';
        // Build synced LRC from timestamp data if available
        if (mxResult.synced && Array.isArray(mxResult.synced)) {
          const lrcLines: string[] = [];
          for (const entry of mxResult.synced) {
            if (entry.text?.trim() && entry.time) {
              const totalSec = entry.time.total || (entry.time.minutes * 60 + entry.time.seconds + entry.time.hundredths / 100);
              const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
              const ss = String(Math.floor(totalSec % 60)).padStart(2, '0');
              const cs = String(Math.floor((totalSec % 1) * 100)).padStart(2, '0');
              lrcLines.push(`[${mm}:${ss}.${cs}]${entry.text}`);
            }
          }
          if (lrcLines.length > 0) syncedLrc = lrcLines.join('\n');
        }
        console.log(`[SCRAPER] Layer 2b → Musixmatch Songs: ${rawText.length} chars${syncedLrc ? ' (synced!)' : ''}`);
      } else {
        rawText = null;
      }
    }

    // ─── Layer 3: Genius Live Crawl (parallel URL variants → Puppeteer fallback) ─
    if (!rawText) {
      console.log(`[SCRAPER] Layer 3: Genius Live Crawl`);

      // Collect candidate URLs: API-resolved URL first, then constructed variants
      const geniusResult = await findGeniusUrl(artist, title);
      const variants = buildGeniusUrlVariants(artist, title);
      const candidateUrls = geniusResult?.url
        ? [geniusResult.url, ...variants.filter(u => u !== geniusResult.url)]
        : variants;

      console.log(`[SCRAPER] Layer 3 → probing ${candidateUrls.length} URL variants`);

      // Fire all variants in parallel; take the first non-empty result
      const probeResults = await Promise.allSettled(candidateUrls.map(u => probeGeniusUrl(u)));
      for (let i = 0; i < probeResults.length; i++) {
        const r = probeResults[i];
        if (r.status === 'fulfilled' && r.value && r.value.length > 20) {
          rawText = r.value;
          source = geniusResult && i === 0 ? 'genius-api' : 'genius-cheerio';
          console.log(`[SCRAPER] Layer 3 → hit on variant ${i} (${candidateUrls[i]}): ${rawText.length} chars`);
          break;
        }
      }

      // Heavy fallback: Puppeteer stealth on the primary URL only
      if (!rawText) {
        const primaryUrl = candidateUrls[0];
        console.log(`[SCRAPER] Layer 3 → Puppeteer stealth on ${primaryUrl}`);
        rawText = await scrapePuppeteer(primaryUrl);
        if (rawText && rawText.length > 20) {
          source = 'genius-puppeteer';
          console.log(`[SCRAPER] Layer 3 → Puppeteer: ${rawText.length} chars`);
        } else {
          rawText = null;
        }
      }
    }

    // ─── Layer 4: Timestamp Lyrics RapidAPI ──────────────────────────
    if (!rawText) {
      console.log(`[SCRAPER] Layer 4: Timestamp Lyrics`);
      const tsResult = await fetchTimestampLyrics(`${artist} ${title}`);
      if (tsResult && tsResult.text.length > 20) {
        rawText = tsResult.text;
        source = 'timestamp-rapidapi';
        if (tsResult.syncedLrc) syncedLrc = tsResult.syncedLrc;
        console.log(`[SCRAPER] Layer 4 → Timestamp: ${rawText.length} chars${syncedLrc ? ' (synced!)' : ''}`);
      } else {
        rawText = null;
      }
    }

    // ─── Success: Parse sections and return ──────────────────────────
    if (rawText && rawText.length > 20) {
      const sections = parseSections(rawText);
      return {
        lyrics: {
          artist, title, sections, rawText, source,
          syncedLrc,
          fetchedAt: Date.now(),
        },
      };
    }

    // ─── Layer 5: LRCLib (Final Fallback) ────────────────────────────
    console.log(`[SCRAPER] Layer 5: LRCLib fallback`);
    const lrcResult = await searchLRCLib(artist, title);
    if (lrcResult) {
      console.log(`[SCRAPER] Layer 5 → LRCLib: ${lrcResult.rawText.length} chars`);
      return { lyrics: lrcResult };
    }

    console.log(`[SCRAPER] All layers failed for "${artist} - ${title}"`);
    return { lyrics: null, error: 'All scraping layers failed' };
  }

  /**
   * Multi-source search — returns results with correct artwork.
   * Robust: times out individual sources, never throws.
   */
  async search(query: string): Promise<any[]> {
    console.log(`[SEARCH] Aggregating sources for "${query}"`);
    
    // Reduced timeout for faster fail-over
    const TIMEOUT = 4000;
    
    const settled = await Promise.allSettled([
      Promise.race([searchGeniusRapidAPI(query), timeout(TIMEOUT)]),
      Promise.race([searchGeniusLyricsAPI(query), timeout(TIMEOUT)]),
      Promise.race([searchGeniusOfficialAPI(query), timeout(TIMEOUT)]),
      Promise.race([searchGeniusAJAX(query), timeout(TIMEOUT)]),
      Promise.race([searchGeniusDirectPages(query), timeout(TIMEOUT)]),
      Promise.race([searchLRCLibResults(query), timeout(TIMEOUT)]),
    ]);

    const merged = settled.flatMap((result, index) => {
      if (result.status !== 'fulfilled') return [];
      const label = ['rapidapi', 'geniuslyrics-api', 'genius-official', 'genius-ajax', 'genius-direct', 'lrclib'][index];
      const value = result.value;
      if (!value || !Array.isArray(value)) return [];
      console.log(`[SEARCH] ${label} → ${value.length} results`);
      return value.map((item: any) => ({ ...item, source: item.source || label }));
    });

    return dedupeSearchResults(query, merged).slice(0, 16);
  }
}

// Timeout helper
function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

export const scraper = new ScraperCoordinator();
