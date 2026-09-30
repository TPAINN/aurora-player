import { readJson } from './_lib/recommendations.js';
import { searchYouTube } from './_lib/youtube.js';
import { requestedVariant } from '../shared/audio-variants.js';

let activeRequests = 0;
const TYPES = ['all', 'songs', 'videos', 'albums', 'artists', 'playlists'];
const fold = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const https = value => (typeof value === 'string' && value.startsWith('https://') ? value : '');
// Words that ask for an edit rather than the studio recording.
const EDIT_WORDS = /\b(?:remix|mashup|edit|slowed|reverb|sped\s?up|nightcore|live|cover|acoustic|mix|8d|bootleg|flip)\b/i;

async function itunes(term, entity, limit, signal) {
  const url = new URL('https://itunes.apple.com/search');
  url.search = new URLSearchParams({ term, entity, limit: String(limit) });
  const data = await readJson(url, signal, fetch);
  if (!Array.isArray(data.results)) throw new Error('Invalid catalogue response');
  return data.results;
}

const sources = {
  songs: async (term, signal, limit) => (await itunes(term, 'song', limit, signal))
    .filter(item => item && Number.isSafeInteger(item.trackId) && typeof item.trackName === 'string' && typeof item.artistName === 'string').slice(0, limit),
  albums: async (term, signal, limit) => (await itunes(term, 'album', limit, signal))
    .filter(item => Number.isSafeInteger(item?.collectionId) && item.collectionName)
    .map(item => ({ id: item.collectionId, title: item.collectionName, artist: item.artistName, artwork: https(item.artworkUrl100).replace(/100x100bb/, '600x600bb'), count: item.trackCount || 0, year: String(item.releaseDate || '').slice(0, 4) })),
  artists: async (term, signal, limit) => {
    const url = new URL('https://api.deezer.com/search/artist');
    url.search = new URLSearchParams({ q: term, limit: String(limit) });
    const data = await readJson(url, signal, fetch);
    return (data.data || []).filter(item => Number.isSafeInteger(item?.id) && item.name)
      .map(item => ({ id: item.id, name: item.name, artwork: https(item.picture_xl || item.picture_big), fans: item.nb_fan || 0 }));
  },
  videos: async (term, signal, limit) => (await searchYouTube(term, 'videos', { signal })).videos.slice(0, limit),
  playlists: async (term, signal, limit) => (await searchYouTube(term, 'playlists', { signal })).playlists.slice(0, limit),
};
const ALL_LIMITS = { songs: 20, albums: 8, artists: 6, videos: 10, playlists: 6 };
const ONE_LIMITS = { songs: 36, albums: 24, artists: 16, videos: 24, playlists: 16 };

// The top result follows intent: an artist name, an edit, or the recording.
function topResult(term, result) {
  const artist = result.artists?.[0];
  if (artist && fold(artist.name) === fold(term)) return { kind: 'artist', id: artist.id };
  if ((EDIT_WORDS.test(term) || requestedVariant(term)) && result.videos?.[0]) return { kind: 'video', id: result.videos[0].videoId };
  if (result.results?.[0]) return { kind: 'song', id: result.results[0].trackId };
  if (result.videos?.[0]) return { kind: 'video', id: result.videos[0].videoId };
  if (artist) return { kind: 'artist', id: artist.id };
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { term, type = 'songs' } = req.query || {};
  if (typeof term !== 'string' || !term.trim() || term.length > 200 || Array.from(term).some(character => character.charCodeAt(0) < 32)) {
    return res.status(400).json({ error: 'Enter a search between 1 and 200 characters.' });
  }
  if (!TYPES.includes(type)) return res.status(400).json({ error: 'Unknown search category.' });
  if (activeRequests >= 20) {
    res.setHeader('Retry-After', '2');
    return res.status(503).json({ error: 'Search is busy. Please retry.' });
  }
  activeRequests++;
  try {
    const query = term.trim();
    const kinds = type === 'all' ? Object.keys(sources) : [type];
    const limits = type === 'all' ? ALL_LIMITS : ONE_LIMITS;
    const settled = await Promise.allSettled(kinds.map(kind => sources[kind](query, AbortSignal.timeout(8000), limits[kind])));
    if (settled.every(outcome => outcome.status === 'rejected')) throw new Error('All sources failed');
    const result = {};
    kinds.forEach((kind, index) => { result[kind === 'songs' ? 'results' : kind] = settled[index].status === 'fulfilled' ? settled[index].value : []; });
    if (type === 'all') result.top = topResult(query, result);
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    return res.json(result);
  } catch {
    return res.status(502).json({ error: 'The music catalogue is unavailable. Please retry.' });
  } finally { activeRequests--; }
}
