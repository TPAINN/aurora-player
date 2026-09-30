import { rankForTaste } from './listening';

export function normalizeTrack(item) {
  return { id: String(item.id || item.trackId), title: item.title || item.trackName || 'Untitled', artist: item.artist || item.artistName || 'Unknown artist', album: item.album || item.collectionName || '', artwork: (item.artwork || item.artworkUrl100 || '').replace(/100x100bb/, '600x600bb'), duration: item.duration ?? (item.trackTimeMillis || 0) / 1000, previewUrl: item.previewUrl, videoId: item.videoId, localUrl: item.localUrl, artistId: item.artistId, genre: item.genre || item.primaryGenreName, recommended: item.recommended === true, recommendationReason: item.recommendationReason };
}

// Real catalogue snapshot, refreshed from iTunes on 2026-09-25; keeps discovery available offline.
const snapshot =[
  {
    "trackId": 1499378607,
    "trackName": "Blinding Lights",
    "artistName": "The Weeknd",
    "collectionName": "After Hours",
    "artworkUrl100": "https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/6f/bc/e6/6fbce6c4-c38c-72d8-4fd0-66cfff32f679/20UMGIM12176.rgb.jpg/100x100bb.jpg",
    "trackTimeMillis": 200046,
    "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/19/d6/60/19d660ff-e3a9-8377-15a3-ce4b28e89cac/mzaf_18422426156481158187.plus.aac.p.m4a"
  },
  {
    "trackId": 1776748883,
    "trackName": "Glimpse of Us",
    "artistName": "Joji",
    "collectionName": "SMITHEREENS",
    "artworkUrl100": "https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/d0/2a/43/d02a433a-3ab8-9a94-b07d-1dc599b64966/93624864387.jpg/100x100bb.jpg",
    "trackTimeMillis": 233453,
    "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/0c/53/c2/0c53c240-300a-5ddf-fc86-3a54e1b73a78/mzaf_13555682862214742934.plus.aac.p.m4a"
  },
  {
    "trackId": 1714502827,
    "trackName": "Houdini",
    "artistName": "Dua Lipa",
    "collectionName": "Houdini - Single",
    "artworkUrl100": "https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/dd/af/ea/ddafeab5-797a-5b6f-7735-f96c537b45e0/5054197894091.jpg/100x100bb.jpg",
    "trackTimeMillis": 185918,
    "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/2c/da/b5/2cdab5c6-04a8-5231-c697-00101e876479/mzaf_5586859405346659517.plus.aac.p.m4a"
  },
  {
    "trackId": 1640410315,
    "trackName": "Overdose",
    "artistName": "natori",
    "collectionName": "Overdose - Single",
    "artworkUrl100": "https://is1-ssl.mzstatic.com/image/thumb/Music112/v4/63/fb/14/63fb149b-4b27-ac16-3029-e815083e16e2/196925612890.jpg/100x100bb.jpg",
    "trackTimeMillis": 197094,
    "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/0a/8c/19/0a8c196b-5257-d55a-5f69-723ce7fe2355/mzaf_794029774251610782.plus.aac.p.m4a"
  },
  {
    "trackId": 1293230534,
    "trackName": "How Long",
    "artistName": "Charlie Puth",
    "collectionName": "Voicenotes",
    "artworkUrl100": "https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/a8/e2/1b/a8e21b3b-9c8d-2974-2318-6bcd4c9d2370/075679884336.jpg/100x100bb.jpg",
    "trackTimeMillis": 200853,
    "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/8f/69/3e/8f693e25-8042-7e76-d0bb-bf181c5256f2/mzaf_3053047544468175536.plus.aac.p.m4a"
  },
  {
    "trackId": 1745005389,
    "trackName": "Omakase",
    "artistName": "ATARASHII GAKKO!",
    "collectionName": "AG! Calling",
    "artworkUrl100": "https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/6d/c4/fa/6dc4fae3-ad12-7319-2c1e-5f49e6bf52aa/198588003725.jpg/100x100bb.jpg",
    "trackTimeMillis": 165960,
    "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/a0/9f/26/a09f265e-0cdf-4f2b-0776-2841813bc7f7/mzaf_6917730569441359558.plus.aac.p.m4a"
  }
]
;
export const SEED_TRACKS = snapshot.map(normalizeTrack);
export async function searchTracks(query, signal) {
  if (!query.trim()) return [];
  const params = new URLSearchParams({ term: query.trim() });
  const response = await fetch(`/api/search?${params}`, { signal });
  if (!response.ok) throw new Error('The music catalogue is unavailable.');
  const data = await response.json();
  if (!Array.isArray(data.results)) throw new Error('The music catalogue returned an invalid response.');
  return data.results.filter(item => item?.trackId && item.trackName).map(normalizeTrack);
}
export async function getFeaturedTracks(signal) {
  signal?.throwIfAborted();
  return SEED_TRACKS;
}

export async function getSimilarTracks(track, signal, { lang } = {}) {
  if (!track?.artist || !track?.title || track.localUrl) return [];
  const query = new URLSearchParams({ artist: track.artist, title: track.title });
  if (track.album) query.set('album', track.album);
  if (track.genre) query.set('genre', String(track.genre).slice(0, 60));
  if (track.duration > 0) query.set('duration', String(Math.round(track.duration)));
  if (lang) query.set('lang', lang);
  const response = await fetch(`/api/recommendations?${query}`, { signal });
  if (!response.ok) throw new Error('Similar songs are temporarily unavailable.');
  const data = await response.json();
  return rankForTaste((Array.isArray(data.tracks) ? data.tracks : []).filter(item => item.id && item.title && item.artist).map(item => ({ ...normalizeTrack(item), lyricsAvailable: item.lyricsAvailable })));
}

// Catalogue tempo for online DJ blends; null when the catalogue does not know it.
export async function getTrackTempo(track, signal) {
  const query = new URLSearchParams({ artist: track.artist, title: track.title });
  const response = await fetch(`/api/tempo?${query}`, { signal });
  if (!response.ok) throw new Error('Tempo metadata is unavailable.');
  const { bpm } = await response.json();
  return Number.isFinite(bpm) && bpm > 0 ? bpm : null;
}
