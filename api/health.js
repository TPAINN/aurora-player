module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({
    status: 'Aurora Video API Operational',
    version: '1.0.0',
    runtime: 'vercel-serverless',
    timestamp: new Date().toISOString(),
  });
};
