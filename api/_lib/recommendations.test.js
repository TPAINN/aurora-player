import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchRecommendations, selectRecommendations, preferAvailableLyrics } from './recommendations.js';
import handler from '../recommendations.js';

const current = { artist: 'The Weeknd', title: 'Blinding Lights' };
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const track = (id, title, artist = current.artist) => ({ id, title, artist, duration: 200 });

test('known lyrics take priority while metadata failure retains candidates', async () => {
  const selected = await preferAvailableLyrics([track('a', 'Unknown timing'), track('b', 'Known timing')], { fetcher: async url => {
    if (url.searchParams.get('track_name') === 'Known timing') return json({ syncedLyrics: '[00:01] Real line' });
    throw new Error('Provider offline');
  } });
  assert.equal(selected[0].id, 'b');
  assert.equal(selected[0].lyricsAvailable, true);
  assert.equal(selected.length, 2);
});

test('recommendations exclude current song and duplicate album versions across catalogues', () => {
  const selected = selectRecommendations([track('1', 'Blinding Lights (Deluxe)'), track('2', 'Save Your Tears'), track('3', 'Save Your Tears - Remastered'), track('4', 'Save Your Tears', 'Other Artist'), track('5', 'Empty', '')], current);
  assert.deepEqual(selected.map(item => item.id), ['2', '4']);
  assert.ok(selected.every(item => item.recommended));
});

test('related artists are interleaved ahead of same-artist songs when no language is known', async () => {
  const requests = [];
  const result = await fetchRecommendations(current, { fetcher: async url => {
    requests.push(url);
    if (url.hostname === 'lrclib.net') throw new Error('Lyrics offline');
    if (url.pathname === '/search/artist') return json({ data: [{ id: 1, name: current.artist }] });
    if (url.pathname === '/search' || url.pathname.endsWith('/radio')) return json({ data: [] });
    if (url.pathname.endsWith('/related')) return json({ data: [{ id: 2, name: 'Related A' }, { id: 3, name: 'Related B' }] });
    const id = Number(url.pathname.split('/')[2]);
    return json({ data: [0, 1, 2].map(index => ({ id: id * 10 + index, title: `Song ${id}-${index}`, artist: { name: `Artist ${id}`, id }, duration: 180, album: { cover_big: 'https://example.com/cover.jpg' } })) });
  } });
  assert.deepEqual(result.slice(0, 4).map(item => item.artist), ['Artist 2', 'Artist 3', 'Artist 2', 'Artist 3']);
  assert.equal(result.length, 6, 'at most two songs per artist');
  assert.ok(requests.every(url => ['api.deezer.com', 'lrclib.net'].includes(url.hostname)));
});

const deezerTrack = (id, title, artist, albumId = id) => ({ id, title, duration: 200, artist: { id: artist.length, name: artist }, album: { id: albumId, title: 'Album', cover_big: 'https://example.com/c.jpg' } });
const lyricsFor = { en: 'I feel it in my heart and you know that I will never let you go baby when the night is over we are gone', es: 'Yo no sé qué me pasa contigo pero cuando te veo me muero por ti y no quiero que te vayas de mi lado', el: 'Σ αγαπώ και σε θέλω πολύ μέσα στη νύχτα' };
function catalogue({ radio = [], related = [], top = [], lyrics = {}, genres = {}, seedLyrics = null }) {
  return async url => {
    if (url.hostname === 'lrclib.net') {
      const title = url.searchParams.get('track_name');
      if (url.pathname === '/api/search') return json(seedLyrics ? [{ plainLyrics: seedLyrics }] : []);
      if (!lyrics[title]) return new Response('{}', { status: 404 });
      return json({ plainLyrics: lyrics[title] });
    }
    if (url.pathname === '/search/artist') return json({ data: [{ id: 99, name: url.searchParams.get('q') }] });
    if (url.pathname === '/search') return json({ data: [{ ...deezerTrack(500, url.searchParams.get('q').match(/track:"([^"]+)"/)[1], url.searchParams.get('q').match(/artist:"([^"]+)"/)[1], 500) }] });
    if (url.pathname.endsWith('/radio')) return json({ data: radio });
    if (url.pathname.endsWith('/related')) return json({ data: related.length ? [{ id: 7, name: 'Rel' }] : [] });
    if (url.pathname === '/artist/7/top') return json({ data: related });
    if (url.pathname.endsWith('/top')) return json({ data: top });
    if (url.pathname.startsWith('/album/')) return json({ genres: { data: (genres[url.pathname.split('/')[2]] || []).map(name => ({ id: 1, name })) } });
    throw new Error(`unexpected ${url}`);
  };
}

test('a Greek seed only queues Greek or unconfirmed songs, confirmed Greek first', async () => {
  const seed = { artist: 'Ελένη Φουρέιρα', title: 'Φωτιά μου' };
  const result = await fetchRecommendations(seed, { fetcher: catalogue({
    radio: [deezerTrack(1, 'Summer Love', 'Some DJ'), deezerTrack(2, 'Μια νύχτα', 'Κωνσταντίνος'), deezerTrack(3, 'Unknown Mood', 'Mystery'), deezerTrack(4, 'Despacito Otra', 'Latino')],
    lyrics: { 'Summer Love': lyricsFor.en, 'Despacito Otra': lyricsFor.es },
  }) });
  assert.deepEqual(result.map(item => item.title), ['Μια νύχτα', 'Unknown Mood']);
});

test('seed language comes from its own lyrics when the title is ambiguous', async () => {
  const seed = { artist: 'Latin Seed', title: 'Corazón Roto' };
  const result = await fetchRecommendations(seed, { fetcher: catalogue({
    seedLyrics: lyricsFor.es,
    radio: [deezerTrack(11, 'English Song', 'Anglo'), deezerTrack(12, 'Canción Nueva', 'Hispano')],
    lyrics: { 'English Song': lyricsFor.en, 'Canción Nueva': lyricsFor.es },
  }) });
  assert.deepEqual(result.map(item => item.title), ['Canción Nueva']);
  assert.equal(result[0].lyricsAvailable, true);
});

test('client language wins and incompatible album genres are dropped', async () => {
  const seed = { artist: 'Pop Seed', title: 'Glow' };
  const result = await fetchRecommendations(seed, { lang: 'en', genre: 'Pop', fetcher: catalogue({
    radio: [deezerTrack(21, 'Heavy', 'Metalhead', 21), deezerTrack(22, 'Club', 'Dancer', 22), deezerTrack(23, 'Ballad', 'Singer', 23)],
    lyrics: { Heavy: lyricsFor.en, Club: lyricsFor.en, Ballad: lyricsFor.en },
    genres: { 21: ['Metal'], 22: ['Dance'], 23: ['Pop'], 500: ['Pop'] },
  }) });
  assert.deepEqual(result.map(item => item.title), ['Ballad', 'Club']);
});

test('failed related source falls back only to exact same artist, never unrelated search hits', async () => {
  const result = await fetchRecommendations(current, { fetcher: async url => {
    if (url.hostname === 'api.deezer.com') throw new Error('Offline');
    return json({ results: [
      { trackId: 1, trackName: 'Starboy', artistName: current.artist, trackTimeMillis: 210000 },
      { trackId: 2, trackName: 'Cover', artistName: 'The Weeknd Tribute', trackTimeMillis: 210000 },
      { trackId: 3, trackName: current.title, artistName: current.artist, trackTimeMillis: 210000 },
    ] });
  } });
  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'Starboy');
  assert.equal(result[0].recommendationReason, 'More from The Weeknd');
});

test('aborted requests propagate without trying fallback', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(fetchRecommendations(current, { signal: controller.signal, fetcher: async (_, { signal }) => { calls++; signal.throwIfAborted(); } }), { name: 'AbortError' });
  assert.ok(calls <= 2, 'only the initial parallel lookups run');
});

test('endpoint rejects arrays, control characters, excessive input and non-GET methods', async () => {
  for (const request of [
    { method: 'POST', query: current, expected: 405 },
    { method: 'GET', query: { ...current, artist: ['a', 'b'] }, expected: 400 },
    { method: 'GET', query: { ...current, title: 'a'.repeat(201) }, expected: 400 },
    { method: 'GET', query: { ...current, artist: 'artist\n' }, expected: 400 },
    { method: 'GET', query: { ...current, lang: 'english!' }, expected: 400 },
    { method: 'GET', query: { ...current, genre: ['Pop'] }, expected: 400 },
    { method: 'GET', query: { ...current, duration: '-3' }, expected: 400 },
  ]) {
    const res = { code: 200, setHeader() {}, status(code) { this.code = code; return this; }, json(value) { return value; } };
    const result = await handler(request, res);
    assert.equal(res.code, request.expected);
    assert.ok(result.error);
  }
});

test('oversized catalogue responses fail instead of consuming unbounded memory', async () => {
  await assert.rejects(fetchRecommendations(current, { fetcher: async () => new Response(' '.repeat(500001)) }), /too large/);
});
