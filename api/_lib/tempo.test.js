import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchTempo } from './tempo.js';
import handler from '../tempo.js';

const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const catalogue = bpm => async url => {
  assert.equal(url.hostname, 'api.deezer.com');
  if (url.pathname === '/search') return json({ data: [{ id: 9, title: 'Other Song', artist: { name: 'Band' } }, { id: 10, title: 'Night Drive (Remastered)', artist: { name: 'Band' } }] });
  assert.equal(url.pathname, '/track/10');
  return json({ id: 10, bpm });
};

test('catalogue bpm is returned only for the exact artist and title', async () => {
  assert.deepEqual(await fetchTempo({ artist: 'Band', title: 'Night Drive' }, { fetcher: catalogue(118.2) }), { bpm: 118.2, source: 'Deezer' });
  assert.deepEqual(await fetchTempo({ artist: 'Band', title: 'Unknown Song' }, { fetcher: catalogue(120) }), { bpm: null });
});

test('missing or implausible catalogue tempo is reported as unknown', async () => {
  assert.deepEqual(await fetchTempo({ artist: 'Band', title: 'Night Drive' }, { fetcher: catalogue(0) }), { bpm: null });
  assert.deepEqual(await fetchTempo({ artist: 'Band', title: 'Night Drive' }, { fetcher: catalogue(900) }), { bpm: null });
});

test('tempo endpoint validates input before contacting a provider', async t => {
  const fetcher = t.mock.method(globalThis, 'fetch', () => { throw new Error('Must not fetch'); });
  for (const [method, query, expected] of [['POST', { artist: 'a', title: 'b' }, 405], ['GET', { artist: 'a' }, 400], ['GET', { artist: ['a'], title: 'b' }, 400], ['GET', { artist: 'a\n', title: 'b' }, 400]]) {
    const res = { code: 200, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { return body; } };
    await handler({ method, query }, res);
    assert.equal(res.code, expected);
  }
  assert.equal(fetcher.mock.callCount(), 0);
});
