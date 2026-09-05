// ─── Aurora Design Tokens ──────────────────────────────────────────────────
// Mirrors the live values in App.css:8 (:root). That file is the source of
// truth for the app itself (CSS custom properties, palette-driven at runtime
// by colors.ts). This module re-exports the same values as JS/TS constants
// so other surfaces (the landing page) can import the real tokens instead of
// re-guessing them. If you change a value here, change App.css too.

export const COLOR = {
  bg: 'rgb(6, 7, 14)',
  bgHex: '#060810',
  // Default/fallback 3-tone palette before any album art has been analyzed.
  // Real screens use the live palette extracted by colors.ts (extractColors
  // + buildPalette), which overrides these via --c1/--c2/--c3 at runtime.
  c1: 'rgb(167, 139, 250)', // violet
  c2: 'rgb(244, 114, 182)', // pink
  c3: 'rgb(103, 232, 249)', // cyan
  c1Glow: 'rgb(185, 155, 255)',
  c2Glow: 'rgb(255, 125, 195)',
  c3Glow: 'rgb(115, 242, 255)',
  c1Dim: 'rgb(55, 42, 90)',
} as const;

export const FONT = {
  display: "'Bricolage Grotesque', system-ui, sans-serif",
  mono: "'IBM Plex Mono', monospace",
  googleFontsUrl:
    'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,200..800&family=IBM+Plex+Mono:wght@300;400;500&display=swap',
} as const;

export const MOTION = {
  spring: 'cubic-bezier(0.16, 1, 0.24, 1)',
  dur: '0.58s',
  chorusInDur: '1.8s',
  sectionInDur: '2.0s',
  sectionOutDur: '1.5s',
} as const;

// Uppercase-tracked mono label style used for every small caption in the
// product ("welcome back", "best matches", "sync -/+"). Not a CSS class
// today (each usage sets its own clamp()'d font-size inline/in App.css) --
// this documents the shared shape for new surfaces to match.
export const MONO_LABEL = {
  fontFamily: FONT.mono,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
} as const;

export const WORDMARK = {
  symbol: String.fromCodePoint(0x2726),
  text: 'aurora',
} as const;
