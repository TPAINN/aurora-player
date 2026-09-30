import { fetchLyrics } from '../_lib/lyrics-providers.js';
const cache = new Map();
const requests = new Map();
const pending = new Map();
const empty = { source: null, sync: 'plain', lines: [] };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const query = req.query || {};
  const title = query.title ?? query.track;
  const artist = query.artist;
  const album = query.album ?? '';
  const videoId = query.videoId ?? '';
  const duration = query.duration === undefined ? 0 : Number(query.duration);
  if (![title, artist].every(value => typeof value === 'string' && value.trim() && value.length <= 200)
    || typeof album !== 'string' || album.length > 200
    || typeof videoId !== 'string' || (videoId && !/^[\w-]{11}$/.test(videoId))
    || Array.isArray(query.duration) || !Number.isFinite(duration) || duration < 0 || duration > 86400) {
    return res.status(400).json({ error: 'Valid artist and title are required; duration must be seconds.' });
  }
  const track = { title: title.trim(), artist: artist.trim(), album: album.trim(), videoId, duration };
  const key = JSON.stringify(track);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached?.until > now) return res.json(cached.value);
  // Best-effort warm-instance limit, complemented by CDN caching.
  const ip = String(req.headers?.['x-real-ip'] || req.socket?.remoteAddress || 'unknown').slice(0,100);
  const window = requests.get(ip);
  if (window?.until > now && window.count >= 30) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'Please try again in a minute.' });
  }
  if (requests.size >= 1000) requests.delete(requests.keys().next().value);
  requests.set(ip, { until: window?.until > now ? window.until : now + 60000, count: window?.until > now ? window.count + 1 : 1 });
  if (!pending.has(key) && pending.size >= 30) return res.status(503).json({ error: 'Lyrics service busy. Please retry.' });
  if (!pending.has(key)) pending.set(key, fetchLyrics(track));
  try {
    const value = await pending.get(key) || empty;
    if (cache.size >= 200) cache.delete(cache.keys().next().value);
    cache.set(key, { value, until: now + (value.lines.length ? 3600000 : 30000) });
    res.setHeader('Cache-Control', value.lines.length ? 'public, s-maxage=3600, stale-while-revalidate=86400' : 'public, s-maxage=30');
    return res.json(value);
  } catch {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: 'Lyrics temporarily unavailable', ...empty });
  } finally {
    pending.delete(key);
  }
}
