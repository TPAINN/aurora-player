import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../search.js';

const response = () => ({ code: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return body; } });

test('search rejects invalid input and unsupported methods before contacting a provider', async t => {
  const fetcher = t.mock.method(globalThis, 'fetch', () => { throw new Error('Must not fetch'); });
  for (const [method, term, expected] of [['POST', 'song', 405], ['GET', undefined, 400], ['GET', ['a', 'b'], 400], ['GET', ' ', 400], ['GET', 'a'.repeat(201), 400], ['GET', 'song\n', 400]]) {
    const res = response();
    await handler({ method, query: { term } }, res);
    assert.equal(res.code, expected);
  }
  assert.equal(fetcher.mock.callCount(), 0);
});

test('search uses only fixed upstream, encoded terms, bounded results and a deadline', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url.origin, 'https://itunes.apple.com');
    assert.equal(url.pathname, '/search');
    assert.equal(url.searchParams.get('term'), 'natori & limit=999');
    assert.equal(url.searchParams.get('limit'), '36');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return new Response(JSON.stringify({ results: Array.from({ length: 40 }, (_, i) => ({ trackId: i + 1, trackName: 'Song', artistName: 'Artist' })) }));
  });
  const res = response();
  await handler({ method: 'GET', query: { term: ' natori & limit=999 ' } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.results.length, 36);
});

test('search reports upstream failure and oversized or invalid payloads without caching errors', async t => {
  for (const payload of [new Response('Unavailable', { status: 503 }), new Response(' '.repeat(500001)), new Response('{"results":{}}')]) {
    t.mock.method(globalThis, 'fetch', async () => payload);
    const res = response();
    await handler({ method: 'GET', query: { term: 'song' } }, res);
    assert.equal(res.code, 502);
    assert.ok(res.body.error);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    t.mock.restoreAll();
  }
});
