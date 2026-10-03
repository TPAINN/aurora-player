import { songKey } from '../../shared/titles.js';
import { readJson } from './recommendations.js';
import { detectTitleLanguage } from '../../shared/language.js';
import { MOODS } from '../../shared/moods.js';

export { MOODS };

const LANGUAGE_NAMES = { es: 'spanish', pt: 'brazil', fr: 'french', de: 'german', it: 'italian', el: 'greek', tr: 'turkish', ko: 'k-pop', ja: 'j-pop', zh: 'chinese', ar: 'arabic', hi: 'bollywood', nl: 'dutch', pl: 'polish', sv: 'swedish', ro: 'romanian', cyrl: 'russian', id: 'indonesian' };
const https = value => (typeof value === 'string' && value.startsWith('https://') ? value : '');
const fold = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

// Songs for a mood: the two most-followed playlists for it (in the listener's
// language when known), interleaved, at most two songs per artist.
export async function fetchMood(moodId, { lang = null, fetcher = fetch, signal = AbortSignal.timeout(8000), limit = 24 } = {}) {
  const mood = MOODS.find(item => item.id === moodId);
  if (!mood) throw new Error('Unknown mood');
  const deezer = path => readJson(new URL(path, 'https://api.deezer.com'), signal, fetcher);
  const language = lang && lang !== 'en' ? LANGUAGE_NAMES[lang] : null;
  const query = language ? `${mood.query} ${language}` : mood.query;
  const found = await deezer(`/search/playlist?q=${encodeURIComponent(query)}&limit=10`);
  const playlists = (found.data || []).filter(item => Number.isSafeInteger(item.id) && (item.nb_tracks || 0) >= 15)
    .sort((a, b) => (b.fans || 0) - (a.fans || 0)).slice(0, 2);
  const lists = await Promise.all(playlists.map(item => deezer(`/playlist/${item.id}/tracks?limit=60`).catch(() => ({ data: [] }))));
  const seen = new Set(), perArtist = new Map(), tracks = [];
  const longest = Math.max(0, ...lists.map(list => (list.data || []).length));
  for (let index = 0; index < longest && tracks.length < limit; index++)
    for (const list of lists) {
      const item = list.data?.[index];
      if (!item || !Number.isSafeInteger(item.id) || !item.title || !item.artist?.name) continue;
      // One song once, whatever the version or credit spelling.
      const key = songKey(item.title);
      const artist = fold(item.artist.name);
      if (seen.has(key) || (perArtist.get(artist) || 0) >= 2) continue;
      // With a listening language, drop titles that clearly read as another one.
      const titleLang = lang ? detectTitleLanguage(item.title)?.lang : null;
      if (lang && titleLang && titleLang !== lang) continue;
      seen.add(key); perArtist.set(artist, (perArtist.get(artist) || 0) + 1);
      tracks.push({ id: `deezer:${item.id}`, title: item.title, artist: item.artist.name, artistId: item.artist.id, album: item.album?.title || '', artwork: https(item.album?.cover_xl || item.album?.cover_big), duration: Number(item.duration) || 0, mood: mood.id });
      if (tracks.length >= limit) break;
    }
  return tracks;
}
