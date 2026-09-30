// YouTube InnerTube (the site's own JSON API) for video and playlist discovery:
// remixes, slowed and sped-up edits, mashups and live sets that catalogue
// search does not carry. Endpoints are fixed here; nothing is taken from clients.

export const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8'; // public WEB client key
export const INNERTUBE_CONTEXT = { client: { clientName: 'WEB', clientVersion: '2.20240101.00.00', hl: 'en', gl: 'US' } };
const FILTERS = { videos: 'EgIQAQ==', playlists: 'EgIQAw==' };
const MAX_BYTES = 4_000_000;
const HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  Origin: 'https://www.youtube.com',
};

export async function innertube(endpoint, body, { timeout = 4500, signal } = {}) {
  if (!['search', 'browse'].includes(endpoint)) throw new Error('Unsupported endpoint');
  const response = await fetch(`https://www.youtube.com/youtubei/v1/${endpoint}?key=${INNERTUBE_KEY}`, {
    method: 'POST', headers: HEADERS, redirect: 'error',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
    body: JSON.stringify({ context: INNERTUBE_CONTEXT, ...body }),
  });
  if (!response.ok) throw new Error(`YouTube ${response.status}`);
  const text = await response.text();
  if (text.length > MAX_BYTES) throw new Error('YouTube response too large');
  return JSON.parse(text);
}

const textOf = value => value?.simpleText ?? value?.content ?? (Array.isArray(value?.runs) ? value.runs.map(run => run.text).join('') : '') ?? '';
const seconds = value => String(value || '').split(':').reduce((total, part) => total * 60 + (Number(part) || 0), 0);
const bestThumbnail = list => {
  const items = (Array.isArray(list) ? list : []).filter(item => typeof item?.url === 'string');
  const url = items.sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url || '';
  return url.startsWith('https://') ? url : url.startsWith('//') ? `https:${url}` : '';
};
const cleanChannel = channel => String(channel || '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').replace(/\s*(?:Official|Music)$/i, '').trim();
const DECORATION = /\s*[([](?:official\s+)?(?:hd\s+|4k\s+)?(?:music\s+|lyric\s+)?(?:video|audio|lyrics?|visuali[sz]er|hd|hq|4k|mv|m\/v)(?:\s+video)?[)\]]/gi;

// "Artist - Title (Official Video)" is the dominant upload convention; Topic
// channels carry the artist in the channel name. Edits keep their edit label.
export function splitVideoTitle(rawTitle, channel) {
  const title = String(rawTitle || '').replace(DECORATION, '').replace(/\s*\|.*$/, '').trim();
  if (/\s-\s*Topic$/i.test(channel || '')) return { artist: cleanChannel(channel), title };
  const parts = title.split(/\s+[-–—]\s+/);
  if (parts.length >= 2 && parts[0].length <= 80) return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  return { artist: cleanChannel(channel) || 'Unknown artist', title };
}

function walk(node, visit, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 40) return;
  if (Array.isArray(node)) { for (const item of node) walk(item, visit, depth + 1); return; }
  for (const [key, value] of Object.entries(node)) {
    if (visit(key, value) !== false) walk(value, visit, depth + 1);
  }
}

function toVideo(renderer) {
  const videoId = renderer.videoId;
  if (!/^[\w-]{11}$/.test(videoId || '')) return null;
  const rawTitle = textOf(renderer.title);
  const channel = textOf(renderer.ownerText) || textOf(renderer.shortBylineText) || textOf(renderer.longBylineText);
  const duration = renderer.lengthSeconds ? Number(renderer.lengthSeconds) : seconds(textOf(renderer.lengthText));
  if (!rawTitle || !duration) return null; // live streams and shorts without a length are skipped
  return { videoId, rawTitle, channel, ...splitVideoTitle(rawTitle, channel), duration, artwork: bestThumbnail(renderer.thumbnail?.thumbnails), views: textOf(renderer.viewCountText) || textOf(renderer.shortViewCountText) };
}

export function parseSearch(data) {
  const videos = [], playlists = [];
  walk(data, (key, value) => {
    if (key === 'videoRenderer') { const item = toVideo(value); if (item) videos.push(item); return false; }
    if (key === 'playlistRenderer' && value.playlistId) {
      playlists.push({ id: value.playlistId, title: textOf(value.title), owner: textOf(value.shortBylineText), count: Number(String(value.videoCount || '').replace(/\D/g, '')) || 0, artwork: bestThumbnail(value.thumbnails?.[0]?.thumbnails) });
      return false;
    }
    if (key === 'lockupViewModel' && value.contentType === 'LOCKUP_CONTENT_TYPE_PLAYLIST' && value.contentId) {
      const meta = value.metadata?.lockupMetadataViewModel;
      const thumb = value.contentImage?.collectionThumbnailViewModel?.primaryThumbnail?.thumbnailViewModel;
      let count = 0;
      walk(thumb?.overlays, (inner, badge) => { if (inner === 'thumbnailBadgeViewModel') count = Number(String(badge.text || '').replace(/\D/g, '')) || count; });
      let owner = '';
      walk(meta?.metadata, (inner, part) => { if (!owner && inner === 'text' && typeof part?.content === 'string') owner = part.content; });
      playlists.push({ id: value.contentId, title: textOf(meta?.title), owner, count, artwork: bestThumbnail(thumb?.image?.sources) });
      return false;
    }
  });
  const unique = (list, key) => list.filter((item, index) => list.findIndex(other => other[key] === item[key]) === index);
  return { videos: unique(videos, 'videoId'), playlists: unique(playlists.filter(item => /^[\w-]{2,64}$/.test(item.id) && item.title), 'id') };
}

export function parsePlaylist(data) {
  const tracks = [];
  walk(data, (key, value) => {
    if (key !== 'playlistVideoRenderer') return;
    const item = toVideo(value);
    if (item && tracks.length < 100) tracks.push(item);
    return false;
  });
  return tracks;
}

export async function searchYouTube(query, kind = 'videos', options) {
  return parseSearch(await innertube('search', { query, params: FILTERS[kind] }, options));
}

export async function playlistTracks(id, options) {
  if (!/^[\w-]{2,64}$/.test(id)) throw new Error('Invalid playlist');
  return parsePlaylist(await innertube('browse', { browseId: `VL${id}` }, options));
}
