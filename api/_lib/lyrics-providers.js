import { decodeKrc, parseKrc, parseLrc, parsePlus, parseTrack, parseTtml } from './lyrics-formats.js';

const HOSTS = new Set(['lyrics-api.boidu.dev','lyrics-api.binimum.org','lyrics-storage.binimum.org','lyricsplus.binimum.org','lyricsplus-seven.vercel.app','api-lyrics.simpmusic.org','lrclib.net','krcs.kugou.com','lyrics.kugou.com','music.163.com']);
export function allowedLyricsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && HOSTS.has(url.hostname);
  } catch { return false; }
}
async function get(url, signal, json = true, extraHeaders = {}) {
  if (!allowedLyricsUrl(url)) throw new Error('Disallowed lyrics upstream');
  const response = await fetch(url, { signal, redirect: 'error', headers: { Accept: json ? 'application/json' : 'application/ttml+xml, application/xml, text/xml', 'User-Agent': 'AuroraPlayer/1.0', ...extraHeaders } });
  if (!response.ok) throw new Error(`Lyrics upstream ${response.status}`);
  if (Number(response.headers.get('content-length')) > 500000) throw new Error('Lyrics response too large');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 500000) throw new Error('Lyrics response too large');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const text = Buffer.concat(chunks).toString('utf8');
  return json ? JSON.parse(text) : text;
}
const urlFor = (base, params) => `${base}?${new URLSearchParams(Object.entries(params).filter(([,value]) => value !== '' && value !== 0))}`;
const match = value => String(value).toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]/gu,'');
async function bini(track, signal) {
  const data = await get(urlFor('https://lyrics-api.binimum.org/', { track: track.title, artist: track.artist }),signal);
  const candidates = Array.isArray(data.results) ? data.results : [];
  const hit = candidates.find(item => item && match(item.track_name) === match(track.title) && match(item.artist_name) === match(track.artist) && (!track.duration || Math.abs(Number(item.duration)-track.duration) <= 10));
  // Returned URLs are never a general-purpose fetch proxy.
  if (!hit || !allowedLyricsUrl(hit.lyricsUrl) || new URL(hit.lyricsUrl).hostname !== 'lyrics-storage.binimum.org') return null;
  return parseTtml(await get(hit.lyricsUrl,signal,false),'Bini Lyrics',track.duration,track);
}
async function better(track, signal, qq = false) {
  const data = await get(urlFor(`https://lyrics-api.boidu.dev/${qq ? 'qq/' : ''}getLyrics`, { s: track.title, a: track.artist, d: track.duration, al: track.album }),signal);
  const source = qq ? 'BetterLyrics · QQ' : 'BetterLyrics';
  return parseTtml(data.ttml,source,track.duration,track) || parseLrc(data.syncedLyrics || data.lrc,source,track.duration,track);
}
async function plus(track, signal) {
  for (const host of ['lyricsplus.binimum.org','lyricsplus-seven.vercel.app']) {
    try {
      const data = await get(urlFor(`https://${host}/v2/lyrics/get`, { title: track.title, artist: track.artist, duration: track.duration, album: track.album }),signal);
      const result = parsePlus(data,'LyricsPlus',track.duration,track);
      if (result) return result;
    } catch { if (signal.aborted) return null; }
  }
  return null;
}
async function simp(track, signal) {
  if (!track.videoId) return null;
  const data = await get(`https://api-lyrics.simpmusic.org/v1/${track.videoId}`,signal);
  const hit = data.success && Array.isArray(data.data) && data.data.find(item => item && (!track.duration || Math.abs(Number(item.duration)-track.duration) <= 10));
  return parseTrack(hit,'SimpMusic',track.duration,track);
}
async function lrclib(track, signal) {
  return parseTrack(await get(urlFor('https://lrclib.net/api/get', { track_name: track.title, artist_name: track.artist, duration: track.duration, album_name: track.album }),signal),'LRCLib',track.duration,track);
}
// Fuzzy catalogue search: tolerant of album and small duration differences, never of a different song.
async function lrclibSearch(track, signal) {
  const data = await get(urlFor('https://lrclib.net/api/search', { track_name: track.title, artist_name: track.artist }),signal);
  const candidates = (Array.isArray(data) ? data : []).filter(item => item && match(item.trackName) === match(track.title) && match(item.artistName) === match(track.artist)
    && (!track.duration || Math.abs(Number(item.duration)-track.duration) <= 5));
  const hit = candidates.find(item => item.syncedLyrics) || candidates[0];
  return hit ? parseTrack(hit,'LRCLib',track.duration,track) : null;
}

const near = (seconds, track) => !track.duration || Math.abs(seconds - track.duration) <= 3;
// KuGou: word-timed KRC first, its LRC otherwise; matched on title, artist and duration.
async function kugou(track, signal) {
  const data = await get(urlFor('https://krcs.kugou.com/search', { ver: 1, man: 'yes', client: 'mobi', keyword: `${track.artist} - ${track.title}`, duration: Math.round((track.duration || 0) * 1000) }), signal);
  const hit = (Array.isArray(data.candidates) ? data.candidates : []).find(item => item && match(item.song) === match(track.title) && match(item.singer).includes(match(track.artist)) && near(Number(item.duration) / 1000, track));
  if (!hit || !/^\d+$/.test(String(hit.id)) || !/^[\w]+$/.test(String(hit.accesskey))) return null;
  for (const fmt of ['krc', 'lrc']) {
    try {
      const body = await get(urlFor('https://lyrics.kugou.com/download', { ver: 1, client: 'pc', id: hit.id, accesskey: hit.accesskey, fmt, charset: 'utf8' }), signal);
      const result = fmt === 'krc' ? parseKrc(decodeKrc(body.content), 'KuGou', track.duration,track) : parseLrc(Buffer.from(String(body.content || ''), 'base64').toString('utf8'), 'KuGou', track.duration,track);
      if (result) return result;
    } catch { if (signal.aborted) return null; }
  }
  return null;
}
// NetEase Cloud Music: strong coverage for Asian and many international releases.
async function netease(track, signal) {
  const headers = { Referer: 'https://music.163.com/' };
  const data = await get(urlFor('https://music.163.com/api/search/get', { s: `${track.title} ${track.artist}`, type: 1, limit: 10 }), signal, true, headers);
  const hit = (data.result?.songs || []).find(item => item && match(item.name) === match(track.title) && (item.artists || []).some(artist => match(track.artist).includes(match(artist.name))) && near(Number(item.duration) / 1000, track));
  if (!hit || !Number.isSafeInteger(hit.id)) return null;
  const lyric = await get(urlFor('https://music.163.com/api/song/lyric', { id: hit.id, lv: 1, kv: 1, tv: -1 }), signal, true, headers);
  return parseLrc(lyric.lrc?.lyric, 'NetEase', track.duration,track);
}

// Catalogue decorations that lyric databases usually omit.
export function cleanTrack(track) {
  const title = String(track.title || '')
    .replace(/\s*[([](?:feat|ft|with|prod)\.?\s[^)\]]*[)\]]/gi, '')
    .replace(/\s+-\s+(?:\d{4}\s+)?(?:remaster(?:ed)?|radio edit|single version|album version|mono|stereo|live|edit)\b.*$/i, '')
    .replace(/\s*[([](?:\d{4}\s+)?(?:remaster(?:ed)?|radio edit|single version|album version)[^)\]]*[)\]]/gi, '')
    .trim();
  const artist = String(track.artist || '').split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bx\b|\bwith\b)\s*/i)[0].trim();
  if (!title || !artist || (title === track.title && artist === track.artist)) return null;
  return { ...track, title, artist };
}

const rank = result => result?.sync === 'word' ? 3 : result?.sync === 'line' ? 2 : result ? 1 : 0;
// Resolve on the first genuine word timing; otherwise keep the best fallback.
function race(track, providers, signal) {
  let best = null;
  return new Promise(resolve => {
    let remaining = providers.length;
    for (const provider of providers) {
      Promise.resolve().then(() => provider(track,signal)).catch(() => null).then(result => {
        if (rank(result) > rank(best)) best = result;
        remaining--;
        if (rank(best) === 3 || !remaining) resolve(best);
      });
    }
  });
}

export async function fetchLyrics(track) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(),6500);
  const providers = [simp,better,bini,plus,(t,s) => better(t,s,true),lrclib,lrclibSearch,kugou,netease];
  try {
    const best = await race(track, providers, controller.signal);
    const cleaned = rank(best) < 2 && !controller.signal.aborted ? cleanTrack(track) : null;
    if (!cleaned) return best;
    // The video-bound SimpMusic lookup already ran; retry the text-matched providers.
    const retry = await race(cleaned, [better,bini,plus,lrclib,lrclibSearch,kugou,netease], controller.signal);
    return rank(retry) > rank(best) ? retry : best;
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}
