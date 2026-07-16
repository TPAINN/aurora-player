// Genius search fallback. The full Genius scraper (puppeteer/cheerio) does not
// run on serverless; suggestions are sourced client-side from iTunes, so this
// returns an empty list rather than an HTML page (keeps the client JSON-safe).
module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json([]);
};
