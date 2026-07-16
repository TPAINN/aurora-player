// API base resolution.
//
// Audio + lyric-fallback endpoints are now co-located as Vercel Serverless
// Functions in this same project (see /api). So by default we call them on the
// SAME ORIGIN as the app — no dependency on the old, now-retired Fly.dev host.
//
// An explicit VITE_API_BASE_URL still wins (useful for local dev against a
// separate backend), EXCEPT when it points at the dead Fly.dev host, in which
// case we self-heal back to same-origin.
let configured = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
if (/fly\.dev/i.test(configured)) configured = '';

const API_BASE_URL = configured;

export function buildApiUrl(path, params = {}) {
  const base = API_BASE_URL || window.location.origin;
  const url = new URL(path, base);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}
