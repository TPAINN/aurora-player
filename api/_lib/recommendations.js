import { songKey } from '../../shared/titles.js';
import { compatibleFamilies, detectLanguage, detectTitleLanguage, genreFamily, genreLanguageHint } from '../../shared/language.js';

const fold = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const titleKey = value => fold(String(value || '').replace(/\([^)]*\)|\[[^\]]*\]/g, '').replace(/\s+-\s+(?:remaster|radio|live|explicit|clean|album|single|deluxe).*$/i, ''));

// One song once: versions and differently spelled credits of a title count as the
// same song, and the playing song is never recommended back in any version.
export function selectRecommendations(candidates, current, limit = 8) {
  const seen = new Set([songKey(current.title)]);
  return candidates.filter(track => {
    if (!track.id || !track.title || !track.artist || !Number.isFinite(track.duration) || track.duration <= 0) return false;
    const key = songKey(track.title);
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

// How well a candidate shares the seed's vibe, from catalogue facts only:
// language (the strongest), genre family, era (album year) and popularity tier
// (Deezer rank), with a nudge for songs whose lyrics exist. Unknowns add nothing.
export function vibeScore(track, seed = {}) {
  let score = SOURCE_WEIGHT[track.source] ?? 0;
  if (seed.lang && track.language === seed.lang) score += 3;
  if (track.genreMatch === 'exact') score += 2;
  else if (track.genreMatch === 'compatible') score += 1;
  if (track.lyricsAvailable) score += .5;
  if (seed.year > 0 && track.year > 0) {
    const gap = Math.abs(seed.year - track.year);
    score += gap <= 3 ? 1.5 : gap <= 7 ? 1 : gap <= 15 ? 0 : -1.5;
  }
  if (seed.rank > 0 && track.rank > 0) {
    const tier = Math.abs(Math.log10(track.rank / seed.rank));
    score += tier < .3 ? 1 : tier < .6 ? .5 : tier > 1.2 ? -.5 : 0;
  }
  return score;
}
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

// "A & B", "A x B", "A feat. B", "A, B": the full credit first (real duos such as
// "Simon & Garfunkel" match as they are), then each credited artist on its own.
export function artistCredits(name) {
  const full = String(name || '').trim();
  const parts = full.split(/\s*(?:,|;|\/|&|\+|\bx\b|\band\b|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b|\bvs\.?)\s*/i).map(part => part.trim()).filter(Boolean);
  return [...new Set([full, ...(parts.length > 1 ? parts : [])])].filter(Boolean);
}

// The language an artist's titles share: all of them read as one text, or a clear
// majority of individually readable titles (three or more, at least 60 %).
export function catalogueLanguage(titles) {
  const list = (titles || []).filter(title => typeof title === 'string' && title.trim());
  if (!list.length) return null;
  const together = detectLanguage(list.join(' '))?.lang;
  if (together) return together;
  const votes = new Map();
  for (const title of list) { const lang = detectTitleLanguage(title)?.lang; if (lang) votes.set(lang, (votes.get(lang) || 0) + 1); }
  const [lang, count] = [...votes].sort((a, b) => b[1] - a[1])[0] || [];
  const total = [...votes.values()].reduce((sum, value) => sum + value, 0);
  return count >= 3 && count / total >= 0.6 ? lang : null;
}

export async function fetchRecommendations(current, { fetcher = fetch, signal = AbortSignal.timeout(8000), lang = null, genre = null, limit = 10 } = {}) {
  const deezer = async path => readJson(new URL(path, 'https://api.deezer.com'), AbortSignal.any([signal, AbortSignal.timeout(2200)]), fetcher);
  const optional = promise => promise.catch(error => { if (signal.aborted) throw error; return null; });
  const convert = (item, reason, source) => ({ id: `deezer:${item.id}`, title: item.title, artist: item.artist?.name, artistId: item.artist?.id, album: item.album?.title || '', albumId: item.album?.id, artwork: safeImage(item.album?.cover_xl || item.album?.cover_big), duration: Number(item.duration), rank: Number(item.rank) || 0, recommendationReason: reason, source });
  const tracksOf = (value, reason, source) => (value?.data || []).filter(item => Number.isSafeInteger(item.id)).map(item => convert(item, reason, source));
  // One album lookup gives both the genre families and the release year (the era).
  const albumOf = async id => {
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    if (albumFamilies.has(id)) return albumFamilies.get(id);
    const album = await optional(deezer(`/album/${id}`));
    if (!album) return null;
    const year = Number(String(album.release_date || '').slice(0, 4));
    return remember(albumFamilies, id, { families: new Set((album.genres?.data || []).map(item => genreFamily(item.name)).filter(Boolean)), year: year > 1900 ? year : 0 }, 2000);
  };
  // A title in a non-Latin script is decisive; Latin titles are ambiguous until lyrics say otherwise.
  let seedLang = lang || detectLanguage(`${current.title} ${current.album || ''}`)?.lang || null;
  const seedFamilies = new Set([genreFamily(genre)].filter(Boolean));
  let seedYear = 0, seedRank = 0;
  let pool = [];
  const credits = artistCredits(current.artist);
  const searchNames = credits.slice(0, 3);
  const credited = name => credits.some(credit => fold(credit) === fold(name));
  try {
    const seedQuery = `artist:"${current.artist}" track:"${current.title}"`;
    const [artistLists, seeds] = await Promise.all([
      Promise.all(searchNames.map(name => optional(deezer(`/search/artist?q=${encodeURIComponent(name)}&limit=5`)))),
      optional(deezer(`/search?q=${encodeURIComponent(seedQuery)}&limit=5`)),
    ]);
    const validArtist = item => Number.isSafeInteger(item?.id) && item.id > 0;
    let artist = null;
    searchNames.forEach((name, index) => { artist ||= (artistLists[index]?.data || []).find(item => fold(item.name) === fold(name) && validArtist(item)) || null; });
    let seed = (seeds?.data || []).find(item => credited(item.artist?.name) && titleKey(item.title) === titleKey(current.title));
    if (!artist) {
      // No credited name is an artist on its own: the song itself names its main artist.
      const found = seed || (await optional(deezer(`/search?q=${encodeURIComponent(`${current.title} ${searchNames[1] || current.artist}`)}&limit=10`)))?.data
        ?.find(item => titleKey(item.title) === titleKey(current.title) && validArtist(item.artist));
      if (found && validArtist(found.artist)) { seed ||= found; artist = { id: found.artist.id, name: found.artist.name }; }
    }
    if (artist) {
      const [top, related, radio, seedGenres, seedLyrics] = await Promise.all([
        optional(deezer(`/artist/${artist.id}/top?limit=10`)),
        optional(deezer(`/artist/${artist.id}/related?limit=6`)),
        optional(deezer(`/artist/${artist.id}/radio?limit=25`)),
        albumOf(seed?.album?.id),
        seedLang ? null : lyricProfile(current, fetcher, signal),
      ]);
      seedGenres?.families.forEach(family => seedFamilies.add(family));
      seedYear = seedGenres?.year || 0;
      seedRank = Number(seed?.rank) || 0;
      seedLang ||= seedLyrics?.lang || null;
      // No lyrics to read (instrumental-leaning dance music, for one): the artist's
      // own titles, read together, still say which language they sing in.
      seedLang ||= catalogueLanguage((top?.data || []).map(item => item.title));
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
    const [profile, album] = await Promise.all([lyricProfile(track, fetcher, signal), albumOf(track.albumId)]);
    const language = profile?.lang || detectLanguage(`${track.title} ${track.album}`)?.lang || detectTitleLanguage(track.title)?.lang || null;
    return { ...track, index, language, families: album?.families || null, year: album?.year || 0, lyricsAvailable: profile?.available };
  }));
  const coherent = evaluated.flatMap(track => {
    if (seedLang && track.language && track.language !== seedLang) return [];
    const known = seedFamilies.size && track.families?.size;
    const exactGenre = known && [...track.families].some(family => seedFamilies.has(family));
    if (known && !exactGenre && ![...track.families].some(family => [...seedFamilies].some(seedFamily => compatibleFamilies(seedFamily, family)))) return [];
    const score = vibeScore({ ...track, genreMatch: known ? (exactGenre ? 'exact' : 'compatible') : null }, { lang: seedLang, year: seedYear, rank: seedRank });
    return [{ ...track, score }];
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  // Unchecked candidates are only safe when there is no language to protect.
  const rest = seedLang ? [] : unique.slice(EVALUATED);
  const clean = track => ({ id: track.id, title: track.title, artist: track.artist, artistId: track.artistId, album: track.album, artwork: track.artwork, duration: track.duration, recommendationReason: track.recommendationReason, lyricsAvailable: track.lyricsAvailable, language: track.language, recommended: true });
  const recommendations = diversify([...coherent, ...rest], limit).map(clean);
  if (recommendations.length >= 4) return recommendations;
  const url = new URL('https://itunes.apple.com/search');
  url.search = new URLSearchParams({ term: credits[1] || current.artist, entity: 'song', attribute: 'artistTerm', limit: '30' });
  try {
    const data = await readJson(url, signal, fetcher);
    const fallback = (data.results || []).filter(item => item.trackId && (credited(item.artistName) || artistCredits(item.artistName).some(credited))).map(item => ({ id: String(item.trackId), title: item.trackName, artist: item.artistName, artistId: item.artistId, album: item.collectionName || '', artwork: safeImage(item.artworkUrl100).replace(/100x100bb/, '600x600bb'), duration: Number(item.trackTimeMillis) / 1000, recommendationReason: `More from ${current.artist}` }));
    return selectRecommendations([...recommendations, ...fallback], current, limit);
  } catch (error) {
    if (recommendations.length) return recommendations;
    throw error;
  }
}
