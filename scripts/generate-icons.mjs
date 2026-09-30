// Draws every icon from the in-app brand mark (.brand-mark in src/App.css):
// four rounded bars, 4px wide, 3px apart, heights 14/24/20/10, tilted −17°.
// Usage: npm i --no-save playwright-core && node scripts/generate-icons.mjs
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const ACCENT = '#c3ebcf';
const BACKGROUND = '#101111';
const BARS = [14, 24, 20, 10];
const WIDTH = 4, GAP = 3;

// `scale` sizes the mark inside a 64-unit tile; `radius` rounds the tile.
export function markSvg({ size = 64, scale = 1.55, radius = 16, background = BACKGROUND } = {}) {
  const total = BARS.length * WIDTH + (BARS.length - 1) * GAP;
  const bars = BARS.map((height, i) => {
    const x = 32 + (i * (WIDTH + GAP) - total / 2) * scale;
    return `<rect x="${x.toFixed(2)}" y="${(32 - height * scale / 2).toFixed(2)}" width="${(WIDTH * scale).toFixed(2)}" height="${(height * scale).toFixed(2)}" rx="${(WIDTH * scale / 2).toFixed(2)}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64"><rect width="64" height="64" rx="${radius}" fill="${background}"/><g fill="${ACCENT}" transform="rotate(-17 32 32)">${bars}</g></svg>`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = new URL('../public/', import.meta.url).pathname;
  writeFileSync(`${root}favicon.svg`, markSvg());
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage();
  const png = async (size, options) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<body style="margin:0;background:transparent">${markSvg({ size, ...options })}</body>`);
    return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  };
  const [p16, p32, p48] = [await png(16), await png(32), await png(48)];
  writeFileSync(`${root}favicon-32.png`, p32);
  // Full-bleed squares: iOS and Android apply their own masks.
  writeFileSync(`${root}apple-touch-icon.png`, await png(180, { radius: 0 }));
  writeFileSync(`${root}icon-192.png`, await png(192, { radius: 0 }));
  // Maskable: the mark stays inside the central 80% safe zone.
  writeFileSync(`${root}icon-512.png`, await png(512, { radius: 0, scale: 1.3 }));
  const images = [[16, p16], [32, p32], [48, p48]];
  const header = Buffer.alloc(6); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(([size, data]) => { const e = Buffer.alloc(16); e[0] = size; e[1] = size; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12); offset += data.length; return e; });
  writeFileSync(`${root}favicon.ico`, Buffer.concat([header, ...entries, ...images.map(([, data]) => data)]));
  await browser.close();
}
