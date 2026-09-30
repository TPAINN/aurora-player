import test from 'node:test';
import assert from 'node:assert/strict';
import { MOODS, fetchMood } from './moods.js';

const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const track = (id, title, artist) => ({ id, title, duration: 200, artist: { id: 1000 + id, name: artist }, album: { id: 1, title: 'LP', cover_big: 'https://example.com/c.jpg' } });

test('ten English moods, each with its own search', () => {
  assert.deepEqual(MOODS.map(mood => mood.label), ['Sad', 'Chill', 'Workout', 'Sleep', 'Energize', 'Romance', 'Feel good', 'Party', 'Commute', 'Focus']);
  assert.equal(new Set(MOODS.map(mood => mood.query)).size, 10);
});

test('a mood pulls songs from its most-followed playlists, varied by artist', async () => {
  const queries = [];
  const result = await fetchMood('chill', { fetcher: async url => {
    if (url.pathname === '/search/playlist') { queries.push(url.searchParams.get('q')); return json({ data: [{ id: 1, fans: 10, nb_tracks: 40 }, { id: 2, fans: 900, nb_tracks: 50 }, { id: 3, fans: 5, nb_tracks: 3 }] }); }
    if (url.pathname === '/playlist/2/tracks') return json({ data: [track(1, 'Calm', 'A'), track(2, 'Calm Two', 'A'), track(3, 'Calm Three', 'A'), track(4, 'Breeze', 'B'), track(5, 'Drift', 'C')] });
    if (url.pathname === '/playlist/1/tracks') return json({ data: [track(6, 'Haze', 'D'), track(4, 'Breeze', 'B')] });
    throw new Error(`unexpected ${url}`);
  } });
  assert.deepEqual(queries, ['chill vibes']);
  assert.ok(result.length >= 4);
  assert.ok(result.filter(item => item.artist === 'A').length <= 2, 'at most two songs per artist');
  assert.equal(new Set(result.map(item => item.id)).size, result.length, 'no duplicates');
  assert.ok(result.every(item => item.mood === 'chill'));
});

test('a known listening language narrows the mood to it', async () => {
  const queries = [];
  const result = await fetchMood('sad', { lang: 'es', fetcher: async url => {
    if (url.pathname === '/search/playlist') { queries.push(url.searchParams.get('q')); return json({ data: [{ id: 7, fans: 100, nb_tracks: 30 }] }); }
    return json({ data: [track(1, 'Qué Más Quieres de Mí', 'E'), track(2, 'Deep in the night I feel you', 'F'), track(3, 'Te Quiero', 'G')] });
  } });
  assert.deepEqual(queries, ['sad songs spanish']);
  assert.ok(!result.some(item => item.title.startsWith('Deep in the night')), 'a clearly English title is dropped');
});

test('unknown moods are refused', async () => {
  await assert.rejects(() => fetchMood('angry-metal', { fetcher: async () => json({}) }));
});
