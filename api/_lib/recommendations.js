import { compatibleFamilies, detectLanguage, genreFamily, genreLanguageHint } from '../../shared/language.js';

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

// Bounded caches shared by warm serverless instances.
const remember = (map, key, value, size = 1000) => {
  if (map.size >= size) map.delete(map.keys().next().value);
  map.set(key, value);
  return value;
};
const lyricProfiles = new Map();
const albumFamilies = new Map();
const lyricText = data => String(data?.plainLyrics || data?.syncedLyrics || '').replace(/\[[^\]]*\]/g, ' ');

// Real lyrics decide both availability and language; failures stay unknown, never negative.
async function lyricProfile(track, fetcher, signal) {
  const key = `${fold(track.artist)}:${titleKey(track.title)}`;
  if (lyricProfiles.has(key)) return lyricProfiles.get(key);
  const exact = Number.isFinite(track.duration) && track.duration > 0;
  const url = new URL(exact ? 'https://lrclib.net/api/get' : 'https://lrclib.net/api/search');
  url.search = new URLSearchParams({ artist_name: track.artist, track_name: track.title, ...(exact ? { duration: String(Math.round(track.duration)) } : {}) });
  try {
    let data = await readJson(url, AbortSignal.any([signal, AbortSignal.timeout(1800)]), fetcher);
    if (Array.isArray(data)) data = data.find(item => item?.plainLyrics || item?.syncedLyrics) || null;
    const text = lyricText(data);
    return remember(lyricProfiles, key, { available: Boolean(text.trim()), lang: data?.instrumental ? null : detectLanguage(text)?.lang ?? null });
  } catch { return null; }
}

export async function preferAvailableLyrics(tracks, { fetcher = fetch } = {}) {
  // Check a small leading pool; unavailable metadata must never block radio.
  const checked = await Promise.all(tracks.slice(0, 4).map(async track => {
    const profile = await lyricProfile(track, fetcher, AbortSignal.timeout(1800));
    return profile ? { ...track, lyricsAvailable: profile.available } : track;
  }));
  return [...checked, ...tracks.slice(4)].sort((a, b) => Number(b.lyricsAvailable === true) - Number(a.lyricsAvailable === true));
}

const SOURCE_WEIGHT = { radio: 1.2, related: 1, own: .4 };
const EVALUATED = 14;

// Pick by score while keeping variety: two songs per artist, no back-to-back repeats when avoidable.
function diversify(candidates, limit) {
  const pending = [...candidates];
  const chosen = [];
  const perArtist = new Map();
  while (chosen.length < limit && pending.length) {
    const allowed = pending.filter(item => (perArtist.get(fold(item.artist)) || 0) < 2);
    if (!allowed.length) break;
    const previous = chosen.at(-1) && fold(chosen.at(-1).artist);
    const pick = allowed.find(item => fold(item.artist) !== previous) || allowed[0];
    pending.splice(pending.indexOf(pick), 1);
    perArtist.set(fold(pick.artist), (perArtist.get(fold(pick.artist)) || 0) + 1);
    chosen.push(pick);
  }
  return chosen;
}

export async function fetchRecommendations(current, { fetcher = fetch, signal = AbortSignal.timeout(8000), lang = null, genre = null, limit = 10 } = {}) {
  const deezer = async path => readJson(new URL(path, 'https://api.deezer.com'), AbortSignal.any([signal, AbortSignal.timeout(2200)]), fetcher);
  const optional = promise => promise.catch(error => { if (signal.aborted) throw error; return null; });
  const convert = (item, reason, source) => ({ id: `deezer:${item.id}`, title: item.title, artist: item.artist?.name, artistId: item.artist?.id, album: item.album?.title || '', albumId: item.album?.id, artwork: safeImage(item.album?.cover_big), duration: Number(item.duration), recommendationReason: reason, source });
  const tracksOf = (value, reason, source) => (value?.data || []).filter(item => Number.isSafeInteger(item.id)).map(item => convert(item, reason, source));
  const genresOf = async id => {
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    if (albumFamilies.has(id)) return albumFamilies.get(id);
    const album = await optional(deezer(`/album/${id}`));
    if (!album) return null;
    return remember(albumFamilies, id, new Set((album.genres?.data || []).map(item => genreFamily(item.name)).filter(Boolean)), 2000);
  };
  // A title in a non-Latin script is decisive; Latin titles are ambiguous until lyrics say otherwise.
  let seedLang = lang || detectLanguage(`${current.title} ${current.album || ''}`)?.lang || null;
  const seedFamilies = new Set([genreFamily(genre)].filter(Boolean));
  let pool = [];
  try {
    const seedQuery = `artist:"${current.artist}" track:"${current.title}"`;
    const [artists, seeds] = await Promise.all([
      deezer(`/search/artist?q=${encodeURIComponent(current.artist)}&limit=5`),
      optional(deezer(`/search?q=${encodeURIComponent(seedQuery)}&limit=5`)),
    ]);
    const artist = (artists.data || []).find(item => fold(item.name) === fold(current.artist) && Number.isSafeInteger(item.id) && item.id > 0);
    const seed = (seeds?.data || []).find(item => fold(item.artist?.name) === fold(current.artist) && titleKey(item.title) === titleKey(current.title));
    if (artist) {
      const [top, related, radio, seedGenres, seedLyrics] = await Promise.all([
        optional(deezer(`/artist/${artist.id}/top?limit=10`)),
        optional(deezer(`/artist/${artist.id}/related?limit=6`)),
        optional(deezer(`/artist/${artist.id}/radio?limit=25`)),
        genresOf(seed?.album?.id),
        seedLang ? null : lyricProfile(current, fetcher, signal),
      ]);
      seedGenres?.forEach(family => seedFamilies.add(family));
      seedLang ||= seedLyrics?.lang || null;
      const relatedArtists = (related?.data || []).filter(item => Number.isSafeInteger(item.id) && item.id > 0).slice(0, 4);
      const groups = await Promise.all(relatedArtists.map(item => optional(deezer(`/artist/${item.id}/top?limit=5`))));
      const relatedTracks = groups.map(group => tracksOf(group, `Similar to ${current.artist}`, 'related'));
      // Interleave related artists so one artist cannot consume the entire radio queue.
      pool = [
        ...tracksOf(radio, `Same vibe as ${current.artist}`, 'radio'),
        ...Array.from({ length: 5 }, (_, index) => relatedTracks.map(group => group[index]).filter(Boolean)).flat(),
        ...tracksOf(top, `More from ${current.artist}`, 'own'),
      ];
    }
  } catch (error) { if (signal.aborted) throw error; }
  seedLang ||= genreLanguageHint(genre);

  const unique = selectRecommendations(pool, current, Infinity);
  const evaluated = await Promise.all(unique.slice(0, EVALUATED).map(async (track, index) => {
    const [profile, families] = await Promise.all([lyricProfile(track, fetcher, signal), seedFamilies.size ? genresOf(track.albumId) : null]);
    const language = profile?.lang || detectLanguage(`${track.title} ${track.album}`)?.lang || null;
    return { ...track, index, language, families, lyricsAvailable: profile?.available };
  }));
  const coherent = evaluated.flatMap(track => {
    if (seedLang && track.language && track.language !== seedLang) return [];
    const known = seedFamilies.size && track.families?.size;
    const exactGenre = known && [...track.families].some(family => seedFamilies.has(family));
    if (known && !exactGenre && ![...track.families].some(family => [...seedFamilies].some(seedFamily => compatibleFamilies(seedFamily, family)))) return [];
    const score = SOURCE_WEIGHT[track.source] + (seedLang && track.language === seedLang ? 3 : 0) + (known ? (exactGenre ? 2 : 1) : 0) + (track.lyricsAvailable ? .5 : 0);
    return [{ ...track, score }];
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  // Unchecked candidates are only safe when there is no language to protect.
  const rest = seedLang ? [] : unique.slice(EVALUATED);
  const clean = track => ({ id: track.id, title: track.title, artist: track.artist, artistId: track.artistId, album: track.album, artwork: track.artwork, duration: track.duration, recommendationReason: track.recommendationReason, lyricsAvailable: track.lyricsAvailable, language: track.language, recommended: true });
  const recommendations = diversify([...coherent, ...rest], limit).map(clean);
  if (recommendations.length >= 4) return recommendations;
  const url = new URL('https://itunes.apple.com/search');
  url.search = new URLSearchParams({ term: current.artist, entity: 'song', attribute: 'artistTerm', limit: '30' });
  try {
    const data = await readJson(url, signal, fetcher);
    const fallback = (data.results || []).filter(item => item.trackId && fold(item.artistName) === fold(current.artist)).map(item => ({ id: String(item.trackId), title: item.trackName, artist: item.artistName, artistId: item.artistId, album: item.collectionName || '', artwork: safeImage(item.artworkUrl100).replace(/100x100bb/, '600x600bb'), duration: Number(item.trackTimeMillis) / 1000, recommendationReason: `More from ${current.artist}` }));
    return selectRecommendations([...recommendations, ...fallback], current, limit);
  } catch (error) {
    if (recommendations.length) return recommendations;
    throw error;
  }
}
