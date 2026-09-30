# Aurora architecture

- `src/App.jsx` — responsive application views and accessible controls.
- `src/App.css` — shared visual tokens, layouts and responsive rules.
- `src/hooks/usePlayer.js` — YouTube/device audio lifecycle, queue and media-session controls.
- `src/lib/catalog.js` — catalogue normalization and search.
- `src/components/FluidText.jsx`, `Welcome.jsx` — bounded text and welcome animation.
- `api/lyrics/structured.js` — validated, bounded lyrics endpoint.
- `api/_lib/lyrics-providers.js`, `lyrics-formats.js` — provider fallback and real timing normalization.
- `api/video/search.js` — YouTube video matching.
- `vite.config.js` — local/preview middleware for the production API handlers.
- `public/sw.js` — application-shell cache, excluding online API traffic.
- `web/` — legacy landing-host redirect only.

State is local to the browser. No login, database, upload service or analytics is required. The legacy `server/` implementation is retained separately and is not in the active app request path.
