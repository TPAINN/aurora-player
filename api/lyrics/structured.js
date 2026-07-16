// Structured-lyrics fallback (Musixmatch/Genius sections). Not available on
// serverless; the client uses LRCLib synced lyrics directly. Returns valid JSON.
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({ syncedLrc: null, sections: [] });
};
