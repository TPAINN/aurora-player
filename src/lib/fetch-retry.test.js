import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithRetry } from './fetch-retry.js';

const response = status => ({ ok: status < 400, status });

test('a dropped connection or a busy server is retried, then succeeds', async () => {
  const calls = [];
  const replies = [() => { throw new TypeError('Failed to fetch'); }, () => response(503), () => response(200)];
  const result = await fetchWithRetry('/x', { fetcher: async (url, init) => { calls.push(init?.signal); return replies[calls.length - 1](); }, delays: [1, 1] });
  assert.equal(result.status, 200);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(signal => signal instanceof AbortSignal), 'every attempt has its own timeout');
});

test('a definite answer is never retried', async () => {
  for (const status of [200, 400, 404]) {
    let count = 0;
    const result = await fetchWithRetry('/x', { fetcher: async () => { count++; return response(status); }, delays: [1, 1] });
    assert.equal(result.status, status); assert.equal(count, 1, String(status));
  }
});

test('after the last attempt the failure reaches the caller', async () => {
  let count = 0;
  const result = await fetchWithRetry('/x', { fetcher: async () => { count++; return response(502); }, delays: [1, 1] });
  assert.equal(result.status, 502); assert.equal(count, 3);
  await assert.rejects(fetchWithRetry('/x', { fetcher: async () => { throw new TypeError('offline'); }, delays: [1] }), /offline/);
});

test('a request that hangs is cut off and tried again', async () => {
  let count = 0;
  const result = await fetchWithRetry('/x', {
    timeout: 20, delays: [1],
    fetcher: (url, { signal }) => { count++; return count === 1 ? new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))) : Promise.resolve(response(200)); },
  });
  assert.equal(result.status, 200); assert.equal(count, 2);
});

test('a caller that gives up stops the retries at once', async () => {
  const controller = new AbortController(); controller.abort();
  let count = 0;
  await assert.rejects(fetchWithRetry('/x', { signal: controller.signal, fetcher: async () => { count++; throw new TypeError('x'); }, delays: [1, 1] }));
  assert.ok(count <= 1);
});
