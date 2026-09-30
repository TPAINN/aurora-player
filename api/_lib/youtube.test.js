import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSearch, parsePlaylist, splitVideoTitle, searchYouTube } from './youtube.js';

const run = text => ({ runs: [{ text }] });
const video = (id, title, channel, length) => ({ videoRenderer: { videoId: id, title: run(title), ownerText: run(channel), lengthText: { simpleText: length }, thumbnail: { thumbnails: [{ url: `https://i.ytimg.com/vi/${id}/hq720.jpg`, width: 720 }] }, viewCountText: { simpleText: '1,234,567 views' } } });
const searchFixture = { contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: [
  video('aaaaaaaaaaa', 'The Weeknd - Blinding Lights (slowed + reverb)', 'lofi edits', '4:10'),
  { adSlotRenderer: {} },
  video('bbbbbbbbbbb', 'Blinding Lights', 'The Weeknd - Topic', '3:22'),
  { playlistRenderer: { playlistId: 'PLxyz', title: { simpleText: 'Weeknd Essentials' }, videoCount: '42', shortBylineText: run('Curator'), thumbnails: [{ thumbnails: [{ url: 'https://i.ytimg.com/vi/x/hqdefault.jpg' }] }] } },
  { lockupViewModel: { contentId: 'PLabc', contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST', metadata: { lockupMetadataViewModel: { title: { content: 'Night Drive Mix' }, metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { content: 'Someone' } }] }] } } } }, contentImage: { collectionThumbnailViewModel: { primaryThumbnail: { thumbnailViewModel: { image: { sources: [{ url: 'https://i.ytimg.com/vi/y/hqdefault.jpg' }] }, overlays: [{ thumbnailOverlayBadgeViewModel: { thumbnailBadges: [{ thumbnailBadgeViewModel: { text: '18 videos' } }] } }] } } } } } },
] } }] } } } } };

test('video and playlist results are parsed from both renderer generations', () => {
  const { videos, playlists } = parseSearch(searchFixture);
  assert.deepEqual(videos.map(item => item.videoId), ['aaaaaaaaaaa', 'bbbbbbbbbbb']);
  assert.equal(videos[0].duration, 250);
  assert.equal(videos[1].artist, 'The Weeknd');
  assert.equal(videos[1].title, 'Blinding Lights');
  assert.equal(videos[0].artist, 'The Weeknd');
  assert.equal(videos[0].title, 'Blinding Lights (slowed + reverb)');
  assert.ok(videos[0].artwork.startsWith('https://i.ytimg.com/'));
  assert.deepEqual(playlists.map(item => [item.id, item.title, item.count]), [['PLxyz', 'Weeknd Essentials', 42], ['PLabc', 'Night Drive Mix', 18]]);
});

test('artist and title are split from common upload titles', () => {
  assert.deepEqual(splitVideoTitle('Dua Lipa - Houdini (Official Music Video)', 'DuaLipaVEVO'), { artist: 'Dua Lipa', title: 'Houdini' });
  assert.deepEqual(splitVideoTitle('Houdini', 'Dua Lipa - Topic'), { artist: 'Dua Lipa', title: 'Houdini' });
  assert.deepEqual(splitVideoTitle('sweater weather x another love (mashup)', 'edits'), { artist: 'edits', title: 'sweater weather x another love (mashup)' });
  assert.deepEqual(splitVideoTitle('Artist – Song [Lyrics]', 'x'), { artist: 'Artist', title: 'Song' });
});

test('playlist contents are parsed with lengths and a bounded size', () => {
  const items = Array.from({ length: 130 }, (_, i) => ({ playlistVideoRenderer: { videoId: `v${String(i).padStart(10, '0')}`, title: run(`Artist ${i} - Song ${i}`), shortBylineText: run(`Channel ${i}`), lengthSeconds: '200', thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/vi/v/hqdefault.jpg' }] } } }));
  const tracks = parsePlaylist({ contents: { deep: { list: items } } });
  assert.equal(tracks.length, 100);
  assert.equal(tracks[0].title, 'Song 0');
  assert.equal(tracks[0].duration, 200);
});

test('search posts to the fixed InnerTube endpoint with the requested filter', async t => {
  const seen = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => { seen.push([String(url), JSON.parse(options.body)]); return new Response(JSON.stringify(searchFixture)); });
  const result = await searchYouTube('blinding lights', 'videos');
  assert.ok(seen[0][0].startsWith('https://www.youtube.com/youtubei/v1/search'));
  assert.equal(seen[0][1].params, 'EgIQAQ==');
  assert.equal(result.videos.length, 2);
});
