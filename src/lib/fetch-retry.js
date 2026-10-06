// Fetch that survives the network: a dropped connection, a timeout or a busy
// server (408, 429, 5xx) is tried again after a short pause; a definite answer
// (any other status) is returned at once. Each attempt has its own timeout, so a
// request that hangs (a cold serverless start, a stalled mobile link) cannot keep
// the listener waiting forever. A caller's own abort stops everything at once.
const RETRYABLE = status => status === 408 || status === 429 || status >= 500;

export async function fetchWithRetry(url, { signal, timeout = 12000, delays = [700, 1800], fetcher = fetch, ...init } = {}) {
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    const limit = new AbortController();
    const timer = setTimeout(() => limit.abort(new DOMException('The request timed out.', 'TimeoutError')), timeout);
    const combined = signal ? AbortSignal.any([signal, limit.signal]) : limit.signal;
    try {
      const response = await fetcher(url, { ...init, signal: combined });
      if (!RETRYABLE(response.status) || attempt >= delays.length) return response;
    } catch (error) {
      if (signal?.aborted || attempt >= delays.length) throw error;
    } finally {
      clearTimeout(timer);
    }
    await new Promise(resolve => setTimeout(resolve, delays[attempt]));
  }
}
