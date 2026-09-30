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

test('related artists are interleaved ahead of same-artist songs', async () => {
  const requests = [];
  const result = await fetchRecommendations(current, { fetcher: async url => {
    requests.push(url.href);
    if (url.pathname === '/search/artist') return json({ data: [{ id: 1, name: current.artist }] });
    if (url.pathname.endsWith('/related')) return json({ data: [{ id: 2, name: 'Related A' }, { id: 3, name: 'Related B' }] });
    const id = Number(url.pathname.split('/')[2]);
    return json({ data: [0, 1, 2].map(index => ({ id: id * 10 + index, title: `Song ${id}-${index}`, artist: { name: `Artist ${id}`, id }, duration: 180, album: { cover_big: 'https://example.com/cover.jpg' } })) });
  } });
  assert.deepEqual(result.slice(0, 4).map(item => item.artist), ['Artist 2', 'Artist 3', 'Artist 2', 'Artist 3']);
  assert.equal(result.length, 8);
  assert.ok(requests.every(url => new URL(url).hostname === 'api.deezer.com'));
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
  assert.equal(calls, 1);
});

test('endpoint rejects arrays, control characters, excessive input and non-GET methods', async () => {
  for (const request of [
    { method: 'POST', query: current, expected: 405 },
    { method: 'GET', query: { ...current, artist: ['a', 'b'] }, expected: 400 },
    { method: 'GET', query: { ...current, title: 'a'.repeat(201) }, expected: 400 },
    { method: 'GET', query: { ...current, artist: 'artist\n' }, expected: 400 },
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
