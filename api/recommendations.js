import { fetchRecommendations, preferAvailableLyrics } from './_lib/recommendations.js';

const cache = new Map();
const pending = new Map();

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { artist, title } = req.query || {};
  if (![artist, title].every(value => typeof value === 'string' && value.trim() && value.length <= 200 && !Array.from(value).some(character => character.charCodeAt(0) < 32))) {
    return res.status(400).json({ error: 'Valid artist and title are required.' });
  }
  const track = { artist: artist.trim(), title: title.trim() };
  const key = JSON.stringify(track);
  res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=3600');
  const cached = cache.get(key);
  if (cached?.until > Date.now()) return res.json({ tracks: cached.tracks });
  if (!pending.has(key) && pending.size >= 20) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: 'Recommendations are busy. Please retry.' });
  }
  if (!pending.has(key)) pending.set(key, fetchRecommendations(track).then(tracks => preferAvailableLyrics(tracks)));
  try {
    const tracks = await pending.get(key);
    if (cache.size >= 200) cache.delete(cache.keys().next().value);
    cache.set(key, { tracks, until: Date.now() + (tracks.length ? 1_800_000 : 30_000) });
    if (!tracks.length) res.setHeader('Cache-Control', 'public, s-maxage=30');
    return res.json({ tracks });
  } catch {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: 'Similar songs are temporarily unavailable.' });
  } finally { pending.delete(key); }
}

