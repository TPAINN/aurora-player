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

// ── Categorised search ─────────────────────────────────────────────────────
const upstream = routes => async (url, options) => {
  const address = new URL(url);
  for (const [match, body] of routes) if (match(address, options)) return new Response(JSON.stringify(typeof body === 'function' ? body(address, options) : body));
  return new Response('{}', { status: 404 });
};
const itunesSong = { trackId: 1, trackName: 'Blinding Lights', artistName: 'The Weeknd', collectionName: 'After Hours', artworkUrl100: 'https://is1-ssl.mzstatic.com/a/100x100bb.jpg', trackTimeMillis: 200000 };
const itunesAlbum = { collectionId: 9, collectionName: 'After Hours', artistName: 'The Weeknd', artworkUrl100: 'https://is1-ssl.mzstatic.com/b/100x100bb.jpg', trackCount: 14, releaseDate: '2020-03-20T07:00:00Z' };
const innertubeVideo = (id, title) => ({ contents: { list: [{ videoRenderer: { videoId: id, title: { runs: [{ text: title }] }, ownerText: { runs: [{ text: 'edits' }] }, lengthText: { simpleText: '3:30' }, thumbnail: { thumbnails: [{ url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` }] } } }] } });
const everything = upstream([
  [a => a.hostname === 'itunes.apple.com' && a.searchParams.get('entity') === 'song', { results: [itunesSong] }],
  [a => a.hostname === 'itunes.apple.com' && a.searchParams.get('entity') === 'album', { results: [itunesAlbum] }],
  [a => a.hostname === 'api.deezer.com', { data: [{ id: 4050205, name: 'The Weeknd', picture_xl: 'https://cdn-images.dzcdn.net/images/artist/x/1000x1000-000000-80-0-0.jpg', nb_fan: 1000 }] }],
  [(a, o) => a.hostname === 'www.youtube.com' && JSON.parse(o.body).params === 'EgIQAQ==', innertubeVideo('ccccccccccc', 'The Weeknd - Blinding Lights (slowed)')],
  [(a, o) => a.hostname === 'www.youtube.com' && JSON.parse(o.body).params === 'EgIQAw==', { contents: [{ playlistRenderer: { playlistId: 'PLweeknd', title: { simpleText: 'Weeknd Mix' }, videoCount: '30', thumbnails: [{ thumbnails: [{ url: 'https://i.ytimg.com/vi/z/hqdefault.jpg' }] }] } }] }],
]);

test('"all" search returns every category and an artist top result for an artist query', async t => {
  t.mock.method(globalThis, 'fetch', everything);
  const res = response();
  await handler({ method: 'GET', query: { term: 'the weeknd', type: 'all' } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.results.length, 1);
  assert.equal(res.body.albums[0].title, 'After Hours');
  assert.equal(res.body.artists[0].name, 'The Weeknd');
  assert.equal(res.body.videos[0].videoId, 'ccccccccccc');
  assert.equal(res.body.playlists[0].id, 'PLweeknd');
  assert.deepEqual(res.body.top, { kind: 'artist', id: 4050205 });
});

test('edit words make a video the top result; plain titles keep the song', async t => {
  t.mock.method(globalThis, 'fetch', everything);
  const edit = response();
  await handler({ method: 'GET', query: { term: 'blinding lights slowed', type: 'all' } }, edit);
  assert.deepEqual(edit.body.top, { kind: 'video', id: 'ccccccccccc' });
  const plain = response();
  await handler({ method: 'GET', query: { term: 'blinding lights', type: 'all' } }, plain);
  assert.deepEqual(plain.body.top, { kind: 'song', id: 1 });
});

test('a single category only contacts its own source and one failing source never fails "all"', async t => {
  const hosts = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => { hosts.push(new URL(url).hostname); if (new URL(url).hostname === 'www.youtube.com') throw new Error('blocked'); return everything(url, options); });
  const albums = response();
  await handler({ method: 'GET', query: { term: 'after hours', type: 'albums' } }, albums);
  assert.deepEqual([...new Set(hosts)], ['itunes.apple.com']);
  assert.equal(albums.body.albums.length, 1);
  const all = response();
  await handler({ method: 'GET', query: { term: 'after hours', type: 'all' } }, all);
  assert.equal(all.code, 200);
  assert.deepEqual(all.body.videos, []);
  assert.equal(all.body.results.length, 1);
});

test('unknown category is rejected', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Must not fetch'); });
  const res = response();
  await handler({ method: 'GET', query: { term: 'x', type: 'podcasts' } }, res);
  assert.equal(res.code, 400);
});
