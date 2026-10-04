import test from 'node:test';
import assert from 'node:assert/strict';
import { liftPixels, softenPixels } from './lit-artwork.js';

const px = (...rgb) => new Uint8ClampedArray([...rgb, 255]);

test('lifting brightens, enriches colour and adds contrast, like the CSS filters', () => {
  const grey = px(100, 100, 100);
  liftPixels(grey, { brightness: 1.2, saturate: 1.4, contrast: 1.2 });
  // 100·1.2 = 120; grey stays grey under saturate; contrast about mid-grey: (120−127.5)·1.2+127.5 ≈ 118.5
  for (let c = 0; c < 3; c++) assert.ok(Math.abs(grey[c] - 118.5) <= 0.5, [...grey].join());
  assert.equal(grey[3], 255);
  const red = px(180, 60, 60);
  liftPixels(red, { brightness: 1, saturate: 1.4, contrast: 1 });
  assert.ok(red[0] > 180 && red[1] < 60, [...red].join()); // more saturated, same luminance pull
  const white = px(250, 250, 250);
  liftPixels(white, { brightness: 1.3, saturate: 1, contrast: 1.2 });
  assert.equal(white[0], 255); // clamped, alpha kept
  assert.equal(white[3], 255);
});

test('softening blurs a tiny image so it scales up smoothly, keeping its size and edges', () => {
  const size = 4;
  const data = new Uint8ClampedArray(size * size * 4).fill(0);
  data.set([255, 255, 255, 255], (1 * size + 1) * 4); // one bright pixel
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const out = softenPixels(data, size, size);
  assert.equal(out.length, data.length);
  assert.ok(out[(1 * size + 1) * 4] < 255 && out[(1 * size + 2) * 4] > 0, 'energy spreads to neighbours');
  assert.equal(out[3], 255);
});
