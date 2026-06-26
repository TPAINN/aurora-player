const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? 'https://aurora-player-api.onrender.com').replace(/\/$/, '');

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
