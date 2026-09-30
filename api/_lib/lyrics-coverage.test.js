import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchLyrics, cleanTrack } from './lyrics-providers.js';

const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

test('decorated titles and featured artists are cleaned for a second lookup', () => {
  assert.deepEqual(cleanTrack({ title: 'Stay (feat. Justin Bieber) - Remastered 2021', artist: 'The Kid LAROI & Justin Bieber', duration: 141 }), { title: 'Stay', artist: 'The Kid LAROI', duration: 141 });
  assert.equal(cleanTrack({ title: 'Plain', artist: 'Solo' }), null, 'nothing to clean means no second pass');
});

test('LRCLib search finds synced lyrics the exact lookup misses, within the duration tolerance', async t => {
  t.mock.method(globalThis, 'fetch', async url => {
    const address = new URL(url);
    if (address.hostname === 'lrclib.net' && address.pathname === '/api/search') return json([
      { trackName: 'Night Drive', artistName: 'Band', duration: 300, syncedLyrics: '[00:01.00] wrong length' },
      { trackName: 'Night Drive', artistName: 'Band', duration: 181, syncedLyrics: '[00:01.00] right song' },
    ]);
    return new Response('{}', { status: 404 });
  });
  const result = await fetchLyrics({ title: 'Night Drive', artist: 'Band', album: 'Roads', duration: 180, videoId: '' });
  assert.equal(result.sync, 'line');
  assert.equal(result.lines[0].text, 'right song');
});

test('a cleaned title is retried when the decorated title finds nothing', async t => {
  const seen = [];
  t.mock.method(globalThis, 'fetch', async url => {
    const address = new URL(url);
    if (address.hostname === 'lrclib.net') seen.push(address.searchParams.get('track_name'));
    if (address.hostname === 'lrclib.net' && address.pathname === '/api/search' && address.searchParams.get('track_name') === 'Stay')
      return json([{ trackName: 'Stay', artistName: 'The Kid LAROI', duration: 141, syncedLyrics: '[00:02.00] found it' }]);
    return new Response('{}', { status: 404 });
  });
  const result = await fetchLyrics({ title: 'Stay (feat. Justin Bieber)', artist: 'The Kid LAROI & Justin Bieber', album: '', duration: 141, videoId: '' });
  assert.equal(result?.lines?.[0]?.text, 'found it');
  assert.ok(seen.includes('Stay'));
});
