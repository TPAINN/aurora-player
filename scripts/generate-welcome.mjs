// Build-time Tegaki reveal over exact Manrope 750 outlines. No font/runtime download.
import { readFileSync, writeFileSync } from 'node:fs';
import { createBundle, textToSvg } from 'tegaki/core';

const asset = (name) => JSON.parse(readFileSync(new URL(`./assets/${name}`, import.meta.url)));
const outlines = asset('manrope-750-outlines.json');
for (const path of [...outlines.paths, outlines.dot]) {
  if (!path || /NaN|Infinity|undefined|null/.test(path) || !/^[MmLlHhVvCcSsQqTtAaZz\d\s.,+eE-]+$/.test(path)) {
    throw new Error('Invalid Manrope outline coordinates; regenerate the font paths.');
  }
}
const bundle = createBundle({
  family: 'Manrope', fontUrl: '',
  glyphData: asset('manrope-750-strokes.json'),
  unitsPerEm: outlines.unitsPerEm, ascender: outlines.ascender,
  descender: outlines.descender, lineCap: 'round',
});
const drawing = textToSvg('aurora', bundle, {
  fontSize: 100, letterSpacing: -1.4 * 100 / 30, color: '#fff', mode: 'once',
  timing: { stagger: { advance: 0.12 } },
});
// Use Tegaki's animated centerlines as a mask, not as replacement letterforms.
// Exact font outlines preserve the brand's terminals, counters and weight.
let strokes = [...drawing.matchAll(/<mask[^>]*>([\s\S]*?)<\/mask>/g)].map((m) => m[1]).join('\n');
const timings = [...strokes.matchAll(/dur="([\d.]+)s" begin="([\d.]+)s"/g)];
const end = Math.max(...timings.map((m) => Number(m[1]) + Number(m[2])));
strokes = strokes.replace(/(dur|begin)="([\d.]+)s"/g, (_, key, value) => `${key}="${(Number(value) * 1.1 / end).toFixed(4)}s"`);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-108 53 466 94" width="466" height="94">
<title>Aurora — Manrope 750</title>
<defs><mask id="writing" maskUnits="userSpaceOnUse" x="0" y="50" width="360" height="100">
${strokes}
<rect x="0" y="50" width="360" height="100" fill="white" opacity="0"><animate attributeName="opacity" from="0" to="1" begin="1.1s" dur="0.12s" fill="freeze"/></rect>
</mask></defs>
<g fill="#f5f5f4" mask="url(#writing)">${outlines.paths.map((d) => `<path d="${d}"/>`).join('')}</g>
<g fill="#c3ebcf" transform="translate(-93 99) rotate(-17)">
${[14, 24, 20, 10].map((height, i) => `<rect x="${i * 70 / 3}" y="${-height * 5 / 3}" width="${40 / 3}" height="${height * 10 / 3}" rx="10" opacity="0"><animate attributeName="opacity" from="0" to="1" begin="${i * 0.06}s" dur="0.24s" fill="freeze"/></rect>`).join('')}
</g>
<path d="${outlines.dot}" fill="#c3ebcf" opacity="0"><animate attributeName="opacity" from="0" to="1" begin="1.12s" dur="0.18s" fill="freeze"/></path>
</svg>\n`;
writeFileSync(new URL('../public/aurora-welcome.svg', import.meta.url), svg);
console.log(`Generated Aurora welcome: Manrope ${outlines.weight}, ${Buffer.byteLength(svg)} bytes, complete at 1.3 seconds.`);
