import test from 'node:test';
import assert from 'node:assert/strict';
import { recordListening, rankForTaste } from './listening.js';

test('listening preferences stay bounded and favor enjoyed related artists', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) } });
  try {
    const enjoyed = { id: '1', title: 'First song', artist: 'Enjoyed artist' };
    recordListening(enjoyed, 180, 200);
    const candidates = [{ title: 'Other', artist: 'Other artist' }, { title: 'Second song', artist: enjoyed.artist }];
    assert.equal(rankForTaste(candidates)[0].artist, enjoyed.artist);
    recordListening({ ...enjoyed, localUrl: 'blob:test' }, 200, 200);
    assert.equal(JSON.parse(values.get('aurora-listening')).length, 1);
    for (let i = 0; i < 130; i++) recordListening(enjoyed, 8, 200);
    assert.equal(JSON.parse(values.get('aurora-listening')).length, 120);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
});

function withStorage(run) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) } });
  try { return run(values); } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
}

test('repeated skips move the radio seed back to a song the listener finished or liked', async () => {
  const { pickSeed, recordListening: record, recordLike } = await import('./listening.js');
  withStorage(() => {
    const loved = { id: 'a', title: 'Loved', artist: 'Anchor', artwork: 'x' };
    record(loved, 190, 200);
    const current = { id: 'c', title: 'Current', artist: 'Radio pick' };
    assert.equal(pickSeed(current).track.id, 'c', 'no skips: follow the current song');
    record({ id: 's1', title: 'Skip one', artist: 'Radio pick', recommended: true }, 9, 200);
    record({ id: 's2', title: 'Skip two', artist: 'Radio other', recommended: true }, 7, 200);
    const seed = pickSeed(current);
    assert.equal(seed.track.id, 'a');
    assert.match(seed.reason, /Loved/);
    recordLike({ id: 'l', title: 'Liked later', artist: 'Favourite' });
    assert.equal(pickSeed(current).track.id, 'l', 'the freshest positive signal wins');
  });
});

test('artists the listener keeps skipping and songs heard recently are filtered out', async () => {
  const { tasteFilter, recordListening: record } = await import('./listening.js');
  withStorage(() => {
    for (let i = 0; i < 3; i++) record({ id: `n${i}`, title: `Nope ${i}`, artist: 'Skipped artist' }, 6, 200);
    record({ id: 'h', title: 'Heard', artist: 'Fine artist' }, 190, 200);
    const kept = tasteFilter([{ id: '1', title: 'New', artist: 'Skipped artist' }, { id: '2', title: 'Heard', artist: 'Fine artist' }, { id: '3', title: 'Fresh', artist: 'Fine artist' }]);
    assert.deepEqual(kept.map(item => item.id), ['3']);
  });
});

test('home seeds are the most enjoyed distinct artists, newest first', async () => {
  const { homeSeeds, recordListening: record } = await import('./listening.js');
  withStorage(() => {
    record({ id: '1', title: 'One', artist: 'A' }, 190, 200);
    record({ id: '2', title: 'Two', artist: 'B' }, 190, 200);
    record({ id: '3', title: 'Three', artist: 'A' }, 190, 200);
    record({ id: '4', title: 'Four', artist: 'C' }, 6, 200);
    const seeds = homeSeeds(2);
    assert.deepEqual(seeds.map(item => item.artist), ['A', 'B']);
    assert.equal(seeds[0].title, 'Three');
  });
});

test('without usable history, liked and recently played songs seed the home screen', async () => {
  const { homeSeeds, topArtists } = await import('./listening.js');
  withStorage(values => {
    // Older history entries carry no track snapshot.
    values.set('aurora-listening', JSON.stringify([{ key: 'nf|let you down', artist: 'nf', affinity: 2, at: Date.now() }]));
    const liked = [{ id: 'l1', title: 'Adore You', artist: 'Harry Styles' }, { id: 'l2', title: 'Sign of the Times', artist: 'Harry Styles' }];
    const recent = [{ id: 'r1', title: 'Let You Down', artist: 'NF' }, { id: 'r2', title: 'Chicago', artist: 'Michael Jackson' }];
    const seeds = homeSeeds(3, [...liked, ...recent]);
    assert.deepEqual(seeds.map(item => item.id), ['l1', 'r1', 'r2'], 'one song per artist, likes first');
    assert.deepEqual(topArtists(2, recent), ['NF', 'Michael Jackson']);
  });
});

test('On repeat lists the songs finished most often, newest first on ties, never skips', async () => {
  const { onRepeat } = await import('./listening.js');
  withStorage(() => {
    const a = { id: 'a', title: 'Alpha', artist: 'One' }, b = { id: 'b', title: 'Beta', artist: 'Two' }, c = { id: 'c', title: 'Gamma', artist: 'Three' };
    for (let i = 0; i < 3; i++) recordListening(b, 190, 200);
    recordListening(a, 190, 200); recordListening(a, 195, 200);
    recordListening(c, 10, 200); recordListening(c, 12, 200); recordListening(c, 9, 200);
    const songs = onRepeat(5);
    assert.deepEqual(songs.map(song => song.id), ['b', 'a']);
    assert.equal(onRepeat(5, 3).length, 1, 'a minimum play count');
  });
});

test('the day seed rotates the home mix without inventing songs', async () => {
  const { rotateForDay } = await import('./listening.js');
  const list = [1, 2, 3, 4, 5];
  const monday = rotateForDay(list, new Date('2026-09-28T10:00:00'));
  const tuesday = rotateForDay(list, new Date('2026-09-29T10:00:00'));
  assert.deepEqual([...monday].sort(), list);
  assert.notDeepEqual(monday, tuesday);
  assert.deepEqual(rotateForDay(list, new Date('2026-09-28T23:00:00')), monday, 'stable within a day');
  assert.deepEqual(rotateForDay([], new Date()), []);
});

test('taste ranking keeps the vibe order: known lyrics only nudge, they never leapfrog', () => {
  withStorage(() => {
    // The server ranked these by vibe; the third has lyrics, the first two unknown.
    const candidates = [{ title: 'Closest vibe', artist: 'A' }, { title: 'Next vibe', artist: 'B' }, { title: 'Far vibe', artist: 'C', lyricsAvailable: true }];
    const ranked = rankForTaste(candidates).map(track => track.title);
    assert.deepEqual(ranked.slice(0, 2), ['Closest vibe', 'Next vibe'], ranked.join(' > '));
  });
});
