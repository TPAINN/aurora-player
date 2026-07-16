// Genius unsynced-lyrics fallback. Not available on serverless (needs the
// puppeteer scraper); LRCLib (called directly from the client) is the primary
// synced-lyrics source. Returns valid JSON so the client fallback chain is safe.
module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({ lyrics: null });
};
