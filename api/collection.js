import { readJson } from './_lib/recommendations.js';
import { playlistTracks } from './_lib/youtube.js';

const https = value => (typeof value === 'string' && value.startsWith('https://') ? value : '');
const videoTrack = item => ({ id: `yt:${item.videoId}`, videoId: item.videoId, title: item.title, artist: item.artist, album: '', artwork: item.artwork, duration: item.duration, source: 'video' });

// Opens an album, artist or playlist from search. Each type has one fixed upstream.
const loaders = {
  async album(id, signal) {
    const url = new URL('https://itunes.apple.com/lookup');
    url.search = new URLSearchParams({ id, entity: 'song', limit: '200' });
    const data = await readJson(url, signal, fetch);
    const [collection, ...rest] = data.results || [];
    const tracks = rest.filter(item => item.wrapperType === 'track' && Number.isSafeInteger(item.trackId))
      .sort((a, b) => (a.discNumber || 1) - (b.discNumber || 1) || (a.trackNumber || 0) - (b.trackNumber || 0))
      .map(item => ({ id: String(item.trackId), title: item.trackName, artist: item.artistName, artistId: item.artistId, album: item.collectionName || '', artwork: https(item.artworkUrl100).replace(/100x100bb/, '600x600bb'), duration: Number(item.trackTimeMillis) / 1000 || 0, genre: item.primaryGenreName }));
    return { title: collection?.collectionName || '', subtitle: [collection?.artistName, String(collection?.releaseDate || '').slice(0, 4)].filter(Boolean).join(' · '), artwork: https(collection?.artworkUrl100).replace(/100x100bb/, '600x600bb'), tracks };
  },
  async artist(id, signal) {
    const deezer = path => readJson(new URL(path, 'https://api.deezer.com'), signal, fetch);
    const [artist, top] = await Promise.all([deezer(`/artist/${id}`), deezer(`/artist/${id}/top?limit=30`)]);
    const tracks = (top.data || []).filter(item => Number.isSafeInteger(item.id)).map(item => ({ id: `deezer:${item.id}`, title: item.title, artist: item.artist?.name, artistId: item.artist?.id, album: item.album?.title || '', artwork: https(item.album?.cover_xl || item.album?.cover_big), duration: Number(item.duration) }));
    return { title: artist.name || '', subtitle: 'Top songs', artwork: https(artist.picture_xl || artist.picture_big), tracks };
  },
  async playlist(id, signal) {
    const tracks = (await playlistTracks(id, { signal })).map(videoTrack);
    return { title: '', subtitle: `${tracks.length} videos`, artwork: tracks[0]?.artwork || '', tracks };
  },
};
const VALID = { album: /^\d{1,12}$/, artist: /^\d{1,12}$/, playlist: /^[\w-]{2,64}$/ };

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
  const { type, id } = req.query || {};
  if (typeof type !== 'string' || !VALID[type] || typeof id !== 'string' || !VALID[type].test(id)) return res.status(400).json({ error: 'A valid collection is required.' });
  try {
    const value = await loaders[type](id, AbortSignal.timeout(8000));
    res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=3600');
    return res.json(value);
  } catch {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'This collection could not be opened. Please retry.' });
  }
}
