// ─── Aurora Color Extraction — Material You Adaptive Palette ─────────────────

export interface BeatPalette {
  c: string[];
  glow: string[];
  dim: string;
  bg: string;
}

export const DEFAULT_PALETTE: BeatPalette = {
  c: ['167,139,250', '244,114,182', '103,232,249'],
  glow: ['185,155,255', '255,125,195', '115,242,255'],
  dim: '55,42,90',
  bg: '6,7,14',
};

// ─── HSL helpers ─────────────────────────────────────────────────────────────

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
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
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [
    Math.round(ch(h + 1 / 3) * 255),
    Math.round(ch(h) * 255),
    Math.round(ch(h - 1 / 3) * 255),
  ];
}

// ─── Color Extraction ─────────────────────────────────────────────────────────

export function extractColors(url: string): Promise<string[] | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const bail = setTimeout(() => resolve(null), 5000);

    img.onerror = () => {
      clearTimeout(bail);
      resolve(null);
    };

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
        let totalWeight = 0;
        let satWeight = 0;
        let avgR = 0;
        let avgG = 0;
        let avgB = 0;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2];
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          const l = (max + min) / 510;
          if (l < 0.04 || l > 0.96) continue;
          const d = max - min;
          const s = max === 0 ? 0 : d / (255 * (1 - Math.abs(2 * l - 1)));
          const midness = 1 - Math.abs(2 * l - 1);
          const baseW = Math.max(0.08, Math.pow(Math.max(s, 0.02), 1.2)) * Math.max(midness, 0.18);
          totalWeight += baseW;
          satWeight += s * baseW;
          avgR += r * baseW;
          avgG += g * baseW;
          avgB += b * baseW;
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
        const neutralBase: [number, number, number] | null =
          totalWeight > 0
            ? [Math.round(avgR / totalWeight), Math.round(avgG / totalWeight), Math.round(avgB / totalWeight)]
            : null;

        if (avgSat < 0.16 && neutralBase) {
          const [h, s, lv] = rgbToHsl(...neutralBase);
          const mkNeutral = (lightness: number, satBoost = 0.05) =>
            hslToRgb(h, Math.min(0.12, s + satBoost), lightness).join(',');
          resolve([
            mkNeutral(Math.min(0.38, Math.max(0.16, lv * 0.8))),
            mkNeutral(Math.min(0.48, Math.max(0.22, lv * 0.96)), 0.03),
            mkNeutral(Math.min(0.62, Math.max(0.28, lv * 1.12)), 0.02),
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

// ─── Apply extracted colors as CSS custom properties ─────────────────────────

let _colorRaf: number | null = null;

export function buildPalette(colors: string[] | null): BeatPalette {
  if (!colors) return DEFAULT_PALETTE;

  const parse = (str: string) => str.split(',').map(Number) as [number, number, number];
  const slots = [colors[0], colors[1] ?? colors[0], colors[2] ?? colors[0]];
  const hsls = slots.map((s) => rgbToHsl(...parse(s)));

  const vivid = ([h, s, l]: [number, number, number]) => {
    const guardedL = Math.max(0.38, Math.min(0.62, l * 0.92 + 0.06));
    const guardedS = Math.min(0.9, Math.max(s * 1.15, 0.55));
    return hslToRgb(h, guardedS, guardedL).join(',');
  };

  const dimRgb = hslToRgb(hsls[0][0], Math.min(hsls[0][1] * 0.6, 0.3), Math.max(hsls[0][2] * 0.35, 0.06));
  const bgRgb = hslToRgb(hsls[0][0], Math.min(hsls[0][1] * 0.25, 0.12), Math.max(hsls[0][2] * 0.07, 0.02));

  return {
    c: colors,
    glow: hsls.map(vivid),
    dim: dimRgb.join(','),
    bg: bgRgb.join(','),
  };
}

export function applyPalette(palette: BeatPalette): void {
  if (_colorRaf) cancelAnimationFrame(_colorRaf);
  _colorRaf = requestAnimationFrame(() => {
    _colorRaf = null;
    const root = document.documentElement;
    root.style.setProperty('--c1', palette.c[0]);
    root.style.setProperty('--c2', palette.c[1]);
    root.style.setProperty('--c3', palette.c[2]);
    root.style.setProperty('--c1-glow', palette.glow[0]);
    root.style.setProperty('--c2-glow', palette.glow[1]);
    root.style.setProperty('--c3-glow', palette.glow[2]);
    root.style.setProperty('--c1-dim', palette.dim);
    root.style.setProperty('--bg-rgb', palette.bg);
  });
}
