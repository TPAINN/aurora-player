import test from 'node:test';
import assert from 'node:assert/strict';
import { artworkAt } from './artwork.js';

test('catalogue artwork is requested at the size it will be shown', () => {
  assert.equal(artworkAt('https://is1-ssl.mzstatic.com/image/thumb/a/b.jpg/600x600bb.jpg', 1200), 'https://is1-ssl.mzstatic.com/image/thumb/a/b.jpg/1200x1200bb.jpg');
  assert.equal(artworkAt('https://cdn-images.dzcdn.net/images/cover/abc/500x500-000000-80-0-0.jpg', 1200), 'https://cdn-images.dzcdn.net/images/cover/abc/1000x1000-000000-80-0-0.jpg');
  assert.equal(artworkAt('https://cdn-images.dzcdn.net/images/cover/abc/500x500-000000-80-0-0.jpg', 160), 'https://cdn-images.dzcdn.net/images/cover/abc/160x160-000000-80-0-0.jpg');
  assert.equal(artworkAt('https://example.com/x.jpg', 1200), 'https://example.com/x.jpg');
  assert.equal(artworkAt('', 600), '');
});
