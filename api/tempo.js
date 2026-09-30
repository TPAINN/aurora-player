import { fetchTempo } from './_lib/tempo.js';

const cache = new Map();

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { artist, title } = req.query || {};
  if (![artist, title].every(value => typeof value === 'string' && value.trim() && value.length <= 200 && !Array.from(value).some(character => character.charCodeAt(0) < 32))) {
    return res.status(400).json({ error: 'Valid artist and title are required.' });
  }
  const key = `${artist.trim()}\u0000${title.trim()}`;
  const cached = cache.get(key);
  if (cached) return res.json(cached);
  try {
    const value = await fetchTempo({ artist: artist.trim(), title: title.trim() });
    if (cache.size >= 500) cache.delete(cache.keys().next().value);
    cache.set(key, value);
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    return res.json(value);
  } catch {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ bpm: null, error: 'Tempo metadata is temporarily unavailable.' });
  }
}
