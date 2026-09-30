import { MOODS, fetchMood } from './_lib/moods.js';

const cache = new Map();

// Songs for a mood chip on home, optionally narrowed to the listener's language.
export default async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
  const { mood, lang = '' } = req.query || {};
  if (typeof mood !== 'string' || !MOODS.some(item => item.id === mood) || typeof lang !== 'string' || (lang && !/^[a-z]{2,4}$/.test(lang))) return res.status(400).json({ error: 'A valid mood is required.' });
  const key = `${mood}:${lang}`;
  const cached = cache.get(key);
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  if (cached?.until > Date.now()) return res.json({ tracks: cached.tracks });
  try {
    const tracks = await fetchMood(mood, { lang: lang || null });
    if (cache.size >= 100) cache.delete(cache.keys().next().value);
    cache.set(key, { tracks, until: Date.now() + 3_600_000 });
    return res.json({ tracks });
  } catch {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: 'Moods are temporarily unavailable.' });
  }
}
