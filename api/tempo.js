import { fetchTempo } from './_lib/tempo.js';
import { videoReplays } from './_lib/youtube.js';

const cache = new Map();
const replayCache = new Map();
const VIDEO_ID = /^[\w-]{11}$/;

const remember = (store, key, value) => {
  if (store.size >= 500) store.delete(store.keys().next().value);
  store.set(key, value);
};

// "Most replayed" for the exact video playing; a video without enough views has none.
async function replaysFor(video) {
  if (!video) return undefined;
  if (replayCache.has(video)) return replayCache.get(video);
  try {
    const replays = await videoReplays(video, { timeout: 3500 });
    remember(replayCache, video, replays);
    return replays;
  } catch {
    return [];
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { artist, title, video: rawVideo } = req.query || {};
  if (![artist, title].every(value => typeof value === 'string' && value.trim() && value.length <= 200 && !Array.from(value).some(character => character.charCodeAt(0) < 32))) {
    return res.status(400).json({ error: 'Valid artist and title are required.' });
  }
  const video = typeof rawVideo === 'string' && VIDEO_ID.test(rawVideo) ? rawVideo : null;
  const key = `${artist.trim()}\u0000${title.trim()}`;
  const [tempo, replays] = await Promise.all([
    cache.has(key)
      ? cache.get(key)
      : fetchTempo({ artist: artist.trim(), title: title.trim() }).then(value => { remember(cache, key, value); return value; }, () => null),
    replaysFor(video),
  ]);
  const body = replays === undefined ? tempo : { ...(tempo || { bpm: null }), replays };
  if (!tempo && !replays?.length) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ bpm: null, ...(replays ? { replays } : {}), error: 'Tempo metadata is temporarily unavailable.' });
  }
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
  return res.json(body);
}
