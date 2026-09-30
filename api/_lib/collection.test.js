import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../collection.js';

const response = () => ({ code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return body; } });
const json = value => new Response(JSON.stringify(value));

test('album lists its songs in order with album artwork', async t => {
  t.mock.method(globalThis, 'fetch', async url => {
    const address = new URL(url);
    assert.equal(address.hostname, 'itunes.apple.com');
    assert.equal(address.searchParams.get('id'), '9');
    return json({ results: [
      { wrapperType: 'collection', collectionName: 'After Hours', artistName: 'The Weeknd', artworkUrl100: 'https://is1-ssl.mzstatic.com/b/100x100bb.jpg', releaseDate: '2020-03-20' },
      { wrapperType: 'track', trackId: 2, trackName: 'Too Late', artistName: 'The Weeknd', collectionName: 'After Hours', trackNumber: 2, discNumber: 1, trackTimeMillis: 240000, artworkUrl100: 'https://is1-ssl.mzstatic.com/b/100x100bb.jpg' },
      { wrapperType: 'track', trackId: 1, trackName: 'Alone Again', artistName: 'The Weeknd', collectionName: 'After Hours', trackNumber: 1, discNumber: 1, trackTimeMillis: 250000, artworkUrl100: 'https://is1-ssl.mzstatic.com/b/100x100bb.jpg' },
    ] });
  });
  const res = response();
  await handler({ method: 'GET', query: { type: 'album', id: '9' } }, res);
  assert.equal(res.body.title, 'After Hours');
  assert.deepEqual(res.body.tracks.map(track => track.title), ['Alone Again', 'Too Late']);
  assert.ok(res.body.artwork.includes('600x600bb'));
});

test('artist returns top songs; playlist returns playable videos', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const address = new URL(url);
    if (address.pathname === '/artist/7') return json({ id: 7, name: 'Band', picture_xl: 'https://cdn-images.dzcdn.net/images/artist/a/1000x1000-000000-80-0-0.jpg' });
    if (address.pathname === '/artist/7/top') return json({ data: [{ id: 70, title: 'Hit', duration: 200, artist: { id: 7, name: 'Band' }, album: { title: 'LP', cover_xl: 'https://cdn-images.dzcdn.net/images/cover/c/1000x1000-000000-80-0-0.jpg' } }] });
    assert.equal(JSON.parse(options.body).browseId, 'VLPLmix');
    return json({ x: [{ playlistVideoRenderer: { videoId: 'ddddddddddd', title: { runs: [{ text: 'Band - Hit (slowed)' }] }, shortBylineText: { runs: [{ text: 'edits' }] }, lengthSeconds: '210', thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/vi/d/hqdefault.jpg' }] } } }] });
  });
  const artist = response();
  await handler({ method: 'GET', query: { type: 'artist', id: '7' } }, artist);
  assert.equal(artist.body.title, 'Band');
  assert.equal(artist.body.tracks[0].id, 'deezer:70');
  const playlist = response();
  await handler({ method: 'GET', query: { type: 'playlist', id: 'PLmix' } }, playlist);
  assert.equal(playlist.body.tracks[0].videoId, 'ddddddddddd');
  assert.equal(playlist.body.tracks[0].title, 'Hit (slowed)');
});

test('collection input is validated before contacting a source', async t => {
  const fetcher = t.mock.method(globalThis, 'fetch', () => { throw new Error('Must not fetch'); });
  for (const query of [{ type: 'album', id: 'abc' }, { type: 'movie', id: '1' }, { type: 'playlist', id: 'bad id!' }, { type: 'artist' }]) {
    const res = response();
    await handler({ method: 'GET', query }, res);
    assert.equal(res.code, 400);
  }
  assert.equal(fetcher.mock.callCount(), 0);
});
