// The best-part lift: each cover is drawn once into a tiny canvas, lit (brighter,
// richer, more contrast) and softened in pixel space. Scaled up behind the player
// it reads like a heavy blur, yet it is one plain layer: fading it in costs nothing,
// where a live CSS blur would be redrawn on every frame of the fade.

const clamp = value => Math.min(255, Math.max(0, Math.round(value)));

// The CSS filter chain brightness() saturate() contrast(), per the Filter Effects spec.
export function liftPixels(data, { brightness = 1, saturate = 1, contrast = 1 } = {}) {
  const s = saturate;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] * brightness, g = data[i + 1] * brightness, b = data[i + 2] * brightness;
    const channels = [
      (0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b,
      (0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b,
      (0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b,
    ];
    for (let c = 0; c < 3; c++) data[i + c] = clamp((channels[c] - 127.5) * contrast + 127.5);
  }
  return data;
}

// Two passes of a 3×3 box blur, edges clamped; alpha is kept.
export function softenPixels(data, width, height) {
  let source = data;
  for (let pass = 0; pass < 2; pass++) {
    const out = new Uint8ClampedArray(source.length);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 4;
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const sx = Math.min(width - 1, Math.max(0, x + dx)), sy = Math.min(height - 1, Math.max(0, y + dy));
              sum += source[(sy * width + sx) * 4 + c];
            }
          out[at + c] = Math.round(sum / 9);
        }
        out[at + 3] = source[at + 3];
      }
    source = out;
  }
  return source;
}

const SIZE = 32;
const cache = new Map();

// A data URL of the lit, softened cover; null when the image cannot be read
// (a cover served without CORS taints the canvas: the lift then simply stays off).
export function litArtwork(url, lift) {
  if (!url || typeof document === 'undefined') return Promise.resolve(null);
  const key = `${url}|${JSON.stringify(lift)}`;
  if (!cache.has(key)) {
    cache.set(key, new Promise(resolve => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.decoding = 'async';
      image.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = SIZE;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          context.imageSmoothingQuality = 'high';
          context.drawImage(image, 0, 0, SIZE, SIZE);
          const frame = context.getImageData(0, 0, SIZE, SIZE);
          frame.data.set(softenPixels(liftPixels(frame.data, lift), SIZE, SIZE));
          context.putImageData(frame, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        } catch { resolve(null); }
      };
      image.onerror = () => resolve(null);
      image.src = url;
    }));
    while (cache.size > 24) cache.delete(cache.keys().next().value);
  }
  return cache.get(key);
}
