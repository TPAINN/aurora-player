import { parseLrc, parsePlus, parseTrack, parseTtml } from './lyrics-formats.js';

const HOSTS = new Set(['lyrics-api.boidu.dev','lyrics-api.binimum.org','lyrics-storage.binimum.org','lyricsplus.binimum.org','lyricsplus-seven.vercel.app','api-lyrics.simpmusic.org','lrclib.net']);
export function allowedLyricsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && HOSTS.has(url.hostname);
  } catch { return false; }
}
async function get(url, signal, json = true) {
  if (!allowedLyricsUrl(url)) throw new Error('Disallowed lyrics upstream');
  const response = await fetch(url, { signal, redirect: 'error', headers: { Accept: json ? 'application/json' : 'application/ttml+xml, application/xml, text/xml', 'User-Agent': 'AuroraPlayer/1.0' } });
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
  return parseTtml(await get(hit.lyricsUrl,signal,false),'Bini Lyrics',track.duration);
}
async function better(track, signal, qq = false) {
  const data = await get(urlFor(`https://lyrics-api.boidu.dev/${qq ? 'qq/' : ''}getLyrics`, { s: track.title, a: track.artist, d: track.duration, al: track.album }),signal);
  const source = qq ? 'BetterLyrics · QQ' : 'BetterLyrics';
  return parseTtml(data.ttml,source,track.duration) || parseLrc(data.syncedLyrics || data.lrc,source,track.duration);
}
async function plus(track, signal) {
  for (const host of ['lyricsplus.binimum.org','lyricsplus-seven.vercel.app']) {
    try {
      const data = await get(urlFor(`https://${host}/v2/lyrics/get`, { title: track.title, artist: track.artist, duration: track.duration, album: track.album }),signal);
      const result = parsePlus(data,'LyricsPlus',track.duration);
      if (result) return result;
    } catch { if (signal.aborted) return null; }
  }
  return null;
}
async function simp(track, signal) {
  if (!track.videoId) return null;
  const data = await get(`https://api-lyrics.simpmusic.org/v1/${track.videoId}`,signal);
  const hit = data.success && Array.isArray(data.data) && data.data.find(item => item && (!track.duration || Math.abs(Number(item.duration)-track.duration) <= 10));
  return parseTrack(hit,'SimpMusic',track.duration);
}
async function lrclib(track, signal) {
  return parseTrack(await get(urlFor('https://lrclib.net/api/get', { track_name: track.title, artist_name: track.artist, duration: track.duration, album_name: track.album }),signal),'LRCLib',track.duration);
}
export async function fetchLyrics(track) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(),6500);
  const providers = [simp,better,bini,plus,(t,s) => better(t,s,true),lrclib];
  // Resolve on the first genuine word timing; otherwise keep the best fallback.
  let best = null;
  const rank = result => result?.sync === 'word' ? 3 : result?.sync === 'line' ? 2 : result ? 1 : 0;
  try {
    return await new Promise(resolve => {
      let remaining = providers.length;
      for (const provider of providers) {
        Promise.resolve().then(() => provider(track,controller.signal)).catch(() => null).then(result => {
          if (rank(result) > rank(best)) best = result;
          remaining--;
          if (rank(best) === 3 || !remaining) resolve(best);
        });
      }
    });
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}
