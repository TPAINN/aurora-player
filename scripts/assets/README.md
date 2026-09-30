# Aurora welcome source

`node scripts/generate-welcome.mjs` regenerates the committed SVG with the installed Tegaki 0.22.2 renderer. There is no font or Tegaki runtime request in the app. The animation completes by 1.3 seconds, before the welcome fades at 1.5 seconds.

Both JSON assets derive from the official [Manrope variable font](https://github.com/google/fonts/blob/main/ofl/manrope/Manrope%5Bwght%5D.ttf), SHA-256 `3ae11c49db0455a3cc33e37d380f20fdb8c7f8b41dc07625c177e3d87a9d6ae6`, instantiated at `wght=750` with FontTools. Its OFL license is included here. The app's brand uses Manrope 750, 30px size and -1.4px spacing; the generator scales these dimensions proportionally to 100px.

Stroke data was extracted using the official Tegaki generator at commit `b10bd3aa8bb25ea36b432d45faf2eab1d288e793`, `extractTegakiBundle` with `chars: 'auro.'`, `pipeline: 'geometry'`, `options: DEFAULT_OPTIONS`, and the static 750 font buffer. The `glyphData.json` output is saved as `manrope-750-strokes.json`.

Outlines are the same font's OpenType glyph paths (`opentype.js` 2.0), at 100px size, baseline 128.3, starting x=20 and incrementing each advance by `advanceWidth / 20 - 14 / 3`. They are saved as `manrope-750-outlines.json`. The final letter shapes come from these exact filled font contours; Tegaki centerlines only control their reveal. The last 120ms fills any skeleton extraction gaps. This avoids substituting an approximate handwriting font for the actual brand.
