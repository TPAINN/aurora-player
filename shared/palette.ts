// ─── Aurora palette extraction ─────────────────────────────────────────────
// Faithful extraction of the app's REAL, live palette pipeline (App.jsx's
// inline extractColors/applyColors, ~line 492). src/lib/colors.ts is an
// earlier, similar-but-not-identical draft that nothing in the app actually
// imports -- do not use it as the reference; this file supersedes it.
//
// Algorithm: sample a 100x100 canvas of the cover, weight pixels by
// saturation + mid-lightness (skip near-black/near-white/near-grey), bucket
// hues in 12deg steps, pick up to 3 buckets at least 45deg apart. Falls back
// to a desaturated neutral triad when the cover itself is near-grayscale.

export type RGBTriplet = string; // "r,g,b"

export interface Palette {
  c: [RGBTriplet, RGBTriplet, RGBTriplet];
  glow: [RGBTriplet, RGBTriplet, RGBTriplet];
  dim: RGBTriplet;
  bg: RGBTriplet;
}

export const DEFAULT_PALETTE: Palette = {
  c: ['167,139,250', '244,114,182', '103,232,249'],
  glow: ['185,155,255', '255,125,195', '115,242,255'],
  dim: '55,42,90',
  bg: '6,7,14',
};

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(ch(h + 1 / 3) * 255), Math.round(ch(h) * 255), Math.round(ch(h - 1 / 3) * 255)];
}

/** Extracts up to 3 dominant colors from an image URL as "r,g,b" strings, or null on failure. */
export function extractColors(url: string): Promise<RGBTriplet[] | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const bail = setTimeout(() => resolve(null), 5000);
    img.onerror = () => { clearTimeout(bail); resolve(null); };
    img.onload = () => {
      clearTimeout(bail);
      try {
        const S = 100;
        const cv = document.createElement('canvas');
        cv.width = cv.height = S;
        const ctx = cv.getContext('2d')!;
        ctx.drawImage(img, 0, 0, S, S);
        const { data } = ctx.getImageData(0, 0, S, S);
        const buckets: Record<number, { w: number; r: number; g: number; b: number }> = {};
        let totalWeight = 0, satWeight = 0, avgR = 0, avgG = 0, avgB = 0;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2];
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          const l = (max + min) / 510;
          if (l < 0.04 || l > 0.96) continue;
          const d = max - min;
          const s = max === 0 ? 0 : d / (255 * (1 - Math.abs(2 * l - 1)));
          const midness = 1 - Math.abs(2 * l - 1);
          const baseW = Math.max(0.08, Math.pow(Math.max(s, 0.02), 1.2)) * Math.max(midness, 0.18);
          totalWeight += baseW; satWeight += s * baseW;
          avgR += r * baseW; avgG += g * baseW; avgB += b * baseW;
          if (s < 0.12) continue;
          let h: number;
          if (max === r) h = ((g - b) / d + 6) % 6;
          else if (max === g) h = (b - r) / d + 2;
          else h = (r - g) / d + 4;
          h = (h * 60 + 360) % 360;
          const bucket = (Math.round(h / 12) * 12) % 360;
          if (!buckets[bucket]) buckets[bucket] = { w: 0, r: 0, g: 0, b: 0 };
          buckets[bucket].w += baseW;
          buckets[bucket].r += r * baseW;
          buckets[bucket].g += g * baseW;
          buckets[bucket].b += b * baseW;
        }

        const avgSat = totalWeight > 0 ? satWeight / totalWeight : 0;
        const neutralBase: [number, number, number] | null = totalWeight > 0
          ? [Math.round(avgR / totalWeight), Math.round(avgG / totalWeight), Math.round(avgB / totalWeight)]
          : null;

        if (avgSat < 0.16 && neutralBase) {
          const [h, s, l] = rgbToHsl(...neutralBase);
          const mkNeutral = (lightness: number, satBoost = 0.05) =>
            hslToRgb(h, Math.min(0.12, s + satBoost), lightness).join(',');
          resolve([
            mkNeutral(Math.min(0.38, Math.max(0.16, l * 0.80))),
            mkNeutral(Math.min(0.48, Math.max(0.22, l * 0.96)), 0.03),
            mkNeutral(Math.min(0.62, Math.max(0.28, l * 1.12)), 0.02),
          ]);
          return;
        }

        const sorted = Object.entries(buckets).sort((a, b) => b[1].w - a[1].w);
        const picked: number[] = [];
        for (const [hStr] of sorted) {
          const h = +hStr;
          if (picked.some((p) => Math.min(Math.abs(p - h), 360 - Math.abs(p - h)) < 45)) continue;
          picked.push(h);
          if (picked.length === 3) break;
        }
        if (picked.length === 0) { resolve(null); return; }
        while (picked.length < 3) picked.push(picked[picked.length - 1] ?? picked[0]);

        const colors = picked.map((h) => {
          const bk = buckets[h] ?? buckets[(Math.round(h / 12) * 12) % 360];
          if (!bk || bk.w === 0) {
            const [pr, pg, pb] = hslToRgb(h / 360, 0.38, 0.48);
            return `${pr},${pg},${pb}`;
          }
          return `${Math.round(bk.r / bk.w)},${Math.round(bk.g / bk.w)},${Math.round(bk.b / bk.w)}`;
        });
        resolve(colors);
      } catch {
        resolve(null);
      }
    };
    img.src = url;
  });
}

/** Derives the full Palette (glow/dim/bg variants) from 1-3 extracted "r,g,b" strings, or the default. */
export function buildPalette(colors: RGBTriplet[] | null): Palette {
  if (!colors) return DEFAULT_PALETTE;

  const parse = (str: string) => str.split(',').map(Number) as [number, number, number];
  const slots: [RGBTriplet, RGBTriplet, RGBTriplet] = [colors[0], colors[1] ?? colors[0], colors[2] ?? colors[0]];
  const hsls = slots.map((s) => rgbToHsl(...parse(s)));

  const vivid = ([h, s, l]: [number, number, number]) => {
    const guardedL = Math.max(0.38, Math.min(0.62, l * 0.92 + 0.06));
    return hslToRgb(h, Math.min(Math.max(s * 1.05 + 0.04, 0.42), 0.82), guardedL);
  };
  const dim = ([h, s, l]: [number, number, number]) => hslToRgb(h, s * 0.55, Math.max(l * 0.30, 0.07));

  const glow = hsls.map((hsl) => vivid(hsl).join(',')) as [RGBTriplet, RGBTriplet, RGBTriplet];
  const dimStr = dim(hsls[0]).join(',');

  const [h0, s0] = hsls[0];
  const [sr, sg, sb] = hslToRgb(h0, Math.min(s0 * 0.18, 0.10), 0.046);

  return { c: slots, glow, dim: dimStr, bg: `${sr},${sg},${sb}` };
}

/** Writes a Palette's values onto document.documentElement as the app's --c1/--c2/... CSS custom properties. */
export function applyPalette(palette: Palette): void {
  const root = document.documentElement;
  root.style.setProperty('--c1', palette.c[0]);
  root.style.setProperty('--c2', palette.c[1]);
  root.style.setProperty('--c3', palette.c[2]);
  root.style.setProperty('--c1-glow', palette.glow[0]);
  root.style.setProperty('--c2-glow', palette.glow[1]);
  root.style.setProperty('--c3-glow', palette.glow[2]);
  root.style.setProperty('--c1-dim', palette.dim);
  root.style.setProperty('--bg-rgb', palette.bg);
}