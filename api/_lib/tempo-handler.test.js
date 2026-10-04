import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../tempo.js';

const call = query => new Promise(resolve => {
  const res = { headers: {}, statusCode: 200, setHeader(name, value) { this.headers[name] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { resolve({ status: this.statusCode, body, headers: this.headers }); } };
  handler({ method: 'GET', query }, res);
});

test('tempo and most-replayed arrive together for a validated video id', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const seen = [];
  globalThis.fetch = async (url, options = {}) => {
    seen.push(String(url));
    if (String(url).includes('/youtubei/v1/next')) {
      assert.equal(JSON.parse(options.body).videoId, 'abcdefghijk');
      return new Response(JSON.stringify({ frameworkUpdates: { entityBatchUpdate: { mutations: [{ payload: { macroMarkersListEntity: { markersList: { markerType: 'MARKER_TYPE_HEATMAP', markers: [{ startMillis: '0', durationMillis: '2000', intensityScoreNormalized: 1 }] } } } }] } } }));
    }
    return new Response('{}', { status: 500 });
  };
  const { status, body } = await call({ artist: 'Replay Band', title: 'Replay Song', video: 'abcdefghijk' });
  assert.equal(status, 200);
  assert.deepEqual(body.replays, [{ start: 0, end: 2, score: 1 }]);
  assert.equal(body.bpm, null);
});

test('an invalid video id is never sent upstream', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const seen = [];
  globalThis.fetch = async url => { seen.push(String(url)); return new Response('{}', { status: 500 }); };
  const { status } = await call({ artist: 'Other Band', title: 'Other Song', video: '../x?y=1' });
  assert.equal(status, 503);
  assert.ok(!seen.some(url => url.includes('youtubei')), seen.join());
});
