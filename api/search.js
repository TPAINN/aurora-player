import { readJson } from './_lib/recommendations.js';

let activeRequests = 0;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { term } = req.query || {};
  if (typeof term !== 'string' || !term.trim() || term.length > 200 || Array.from(term).some(character => character.charCodeAt(0) < 32)) {
    return res.status(400).json({ error: 'Enter a search between 1 and 200 characters.' });
  }
  if (activeRequests >= 20) {
    res.setHeader('Retry-After', '2');
    return res.status(503).json({ error: 'Search is busy. Please retry.' });
  }
  activeRequests++;
  try {
    const url = new URL('https://itunes.apple.com/search');
    url.search = new URLSearchParams({ term: term.trim(), entity: 'song', limit: '36' });
    const data = await readJson(url, AbortSignal.timeout(8000), fetch);
    if (!Array.isArray(data.results)) throw new Error('Invalid catalogue response');
    const results = data.results.filter(item => item && Number.isSafeInteger(item.trackId) && typeof item.trackName === 'string' && typeof item.artistName === 'string').slice(0, 36);
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    return res.json({ results });
  } catch {
    return res.status(502).json({ error: 'The music catalogue is unavailable. Please retry.' });
  } finally { activeRequests--; }
}
