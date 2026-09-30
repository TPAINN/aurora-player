const fold = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const titleKey = value => fold(String(value || '').replace(/\([^)]*\)|\[[^\]]*\]/g, '').replace(/\s+-\s+(?:remaster|radio|live|explicit|clean|album|single|deluxe).*$/i, ''));

export function selectRecommendations(candidates, current, limit = 8) {
  const seen = new Set([`${fold(current.artist)}:${titleKey(current.title)}`]);
  return candidates.filter(track => {
    if (!track.id || !track.title || !track.artist || !Number.isFinite(track.duration) || track.duration <= 0) return false;
    const key = `${fold(track.artist)}:${titleKey(track.title)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit).map(track => ({ ...track, recommended: true }));
}

const safeImage = value => {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : ''; } catch { return ''; }
};

export async function readJson(url, signal, fetcher) {
  // Endpoints are constructed here, never accepted from a client or provider response.
  if (!['api.deezer.com', 'itunes.apple.com', 'lrclib.net'].includes(url.hostname) || url.protocol !== 'https:') throw new Error('Unsupported catalogue');
  const response = await fetcher(url, { signal, redirect: 'error', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Catalogue unavailable');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 500_000) throw new Error('Catalogue response too large');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const data = JSON.parse(new TextDecoder().decode(bytes));
  if (data.error) throw new Error('Catalogue unavailable');
  return data;
}

const lyricAvailability = new Map();
export async function preferAvailableLyrics(tracks, { fetcher = fetch } = {}) {
  // Check a small leading pool; unavailable metadata must never block radio.
  const checked = await Promise.all(tracks.slice(0, 4).map(async track => {
    const key = `${fold(track.artist)}:${titleKey(track.title)}`;
    if (lyricAvailability.has(key)) return { ...track, lyricsAvailable: lyricAvailability.get(key) };
    const url = new URL('https://lrclib.net/api/get');
    url.search = new URLSearchParams({ artist_name: track.artist, track_name: track.title, duration: String(Math.round(track.duration)) });
    try {
      const data = await readJson(url, AbortSignal.timeout(1800), fetcher);
      const available = Boolean(data.syncedLyrics || data.plainLyrics);
      if (lyricAvailability.size >= 500) lyricAvailability.delete(lyricAvailability.keys().next().value);
      lyricAvailability.set(key, available);
      return { ...track, lyricsAvailable: available };
    } catch { return track; }
  }));
  return [...checked, ...tracks.slice(4)].sort((a, b) => Number(b.lyricsAvailable === true) - Number(a.lyricsAvailable === true));
}

export async function fetchRecommendations(current, { fetcher = fetch, signal = AbortSignal.timeout(7000) } = {}) {
  const deezer = async path => readJson(new URL(path, 'https://api.deezer.com'), AbortSignal.any([signal, AbortSignal.timeout(2200)]), fetcher);
  let own = [];
  let related = [];
  try {
    const artists = await deezer(`/search/artist?q=${encodeURIComponent(current.artist)}&limit=5`);
    const artist = (artists.data || []).find(item => fold(item.name) === fold(current.artist) && Number.isSafeInteger(item.id) && item.id > 0);
    if (artist) {
      const convert = (item, reason) => ({ id: `deezer:${item.id}`, title: item.title, artist: item.artist?.name, artistId: item.artist?.id, album: item.album?.title || '', artwork: safeImage(item.album?.cover_big), duration: Number(item.duration), recommendationReason: reason });
      const [top, similar] = await Promise.allSettled([deezer(`/artist/${artist.id}/top?limit=12`), deezer(`/artist/${artist.id}/related?limit=3`)]);
      if (top.status === 'fulfilled') own = (top.value.data || []).filter(item => Number.isSafeInteger(item.id)).map(item => convert(item, `More from ${current.artist}`));
      if (similar.status === 'fulfilled') {
        const relatedArtists = (similar.value.data || []).filter(item => Number.isSafeInteger(item.id) && item.id > 0).slice(0, 3);
        const groups = await Promise.allSettled(relatedArtists.map(item => deezer(`/artist/${item.id}/top?limit=4`)));
        const tracks = groups.map(result => result.status === 'fulfilled' ? (result.value.data || []).filter(item => Number.isSafeInteger(item.id)).map(item => convert(item, `Similar to ${current.artist}`)) : []);
        // Interleave related artists so one artist cannot consume the entire radio queue.
        related = Array.from({ length: 4 }, (_, index) => tracks.map(group => group[index]).filter(Boolean)).flat();
      }
    }
  } catch (error) { if (signal.aborted) throw error; }
  const recommendations = selectRecommendations([...related, ...own], current);
  if (recommendations.length >= 4) return recommendations;
  const url = new URL('https://itunes.apple.com/search');
  url.search = new URLSearchParams({ term: current.artist, entity: 'song', attribute: 'artistTerm', limit: '30' });
  try {
    const data = await readJson(url, signal, fetcher);
    const fallback = (data.results || []).filter(item => item.trackId && fold(item.artistName) === fold(current.artist)).map(item => ({ id: String(item.trackId), title: item.trackName, artist: item.artistName, artistId: item.artistId, album: item.collectionName || '', artwork: safeImage(item.artworkUrl100).replace(/100x100bb/, '600x600bb'), duration: Number(item.trackTimeMillis) / 1000, recommendationReason: `More from ${current.artist}` }));
    return selectRecommendations([...recommendations, ...fallback], current);
  } catch (error) {
    if (recommendations.length) return recommendations;
    throw error;
  }
}
