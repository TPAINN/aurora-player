import test from 'node:test';
import assert from 'node:assert/strict';
import { probeBytes, qualityLabel } from './audio-format.js';

const flac = (rate, channels, bits) => {
  const bytes = new Uint8Array(64); bytes.set([0x66, 0x4c, 0x61, 0x43], 0); // fLaC
  bytes.set([0x00, 0, 0, 34], 4); // STREAMINFO header
  const o = 8 + 10;
  bytes[o] = (rate >> 12) & 0xff; bytes[o + 1] = (rate >> 4) & 0xff;
  bytes[o + 2] = ((rate & 0xf) << 4) | ((channels - 1) << 1) | (((bits - 1) >> 4) & 1);
  bytes[o + 3] = ((bits - 1) & 0xf) << 4;
  return bytes;
};
const wav = (format, rate, channels, bits) => {
  const buffer = new ArrayBuffer(44); const view = new DataView(buffer); const text = (at, value) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF'); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, format, true); view.setUint16(22, channels, true); view.setUint32(24, rate, true); view.setUint16(34, bits, true);
  return new Uint8Array(buffer);
};

test('FLAC and WAV report their real sample rate, depth and channels', () => {
  assert.deepEqual(probeBytes(flac(96000, 2, 24), 'song.flac'), { codec: 'FLAC', lossless: true, sampleRate: 96000, bitDepth: 24, channels: 2 });
  assert.deepEqual(probeBytes(wav(1, 44100, 2, 16), 'a.wav'), { codec: 'WAV', lossless: true, sampleRate: 44100, bitDepth: 16, channels: 2 });
  assert.equal(probeBytes(wav(3, 192000, 6, 32), 'a.wav').codec, 'WAV (float)');
  assert.equal(probeBytes(wav(3, 192000, 6, 32), 'a.wav').channels, 6);
});

test('lossy formats are never labelled lossless', () => {
  assert.deepEqual(probeBytes(new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]), 'a.mp3'), { codec: 'MP3', lossless: false });
  const ogg = new Uint8Array(64); ogg.set([0x4f, 0x67, 0x67, 0x53]); ogg.set([...'OpusHead'].map(c => c.charCodeAt(0)), 28);
  assert.equal(probeBytes(ogg, 'a.opus').codec, 'Opus');
  assert.equal(probeBytes(ogg, 'a.opus').lossless, false);
  const mp4 = new Uint8Array(64); mp4.set([...'ftypM4A '].map(c => c.charCodeAt(0)), 4); mp4.set([...'mp4a'].map(c => c.charCodeAt(0)), 40);
  assert.deepEqual(probeBytes(mp4, 'a.m4a'), { codec: 'AAC', lossless: false });
  assert.equal(probeBytes(new Uint8Array(8), 'mystery.bin'), null);
});

test('ALAC in an MP4 container is lossless and reads its magic cookie', () => {
  const bytes = new Uint8Array(160); const view = new DataView(bytes.buffer);
  bytes.set([...'ftypM4A '].map(c => c.charCodeAt(0)), 4);
  bytes.set([...'alac'].map(c => c.charCodeAt(0)), 40); // sample entry
  bytes.set([...'alac'].map(c => c.charCodeAt(0)), 80); // cookie box
  const cookie = 84 + 4; // after version/flags
  bytes[cookie + 5] = 24; bytes[cookie + 9] = 2; view.setUint32(cookie + 20, 88200);
  assert.deepEqual(probeBytes(bytes, 'a.m4a'), { codec: 'ALAC', lossless: true, sampleRate: 88200, bitDepth: 24, channels: 2 });
});

test('quality labels only claim what the file is', () => {
  assert.equal(qualityLabel({ codec: 'FLAC', lossless: true, sampleRate: 96000, bitDepth: 24, channels: 2 }), 'FLAC · 24-bit/96 kHz · Hi-Res Lossless');
  assert.equal(qualityLabel({ codec: 'FLAC', lossless: true, sampleRate: 44100, bitDepth: 16, channels: 2 }), 'FLAC · 16-bit/44.1 kHz · Lossless');
  assert.equal(qualityLabel({ codec: 'WAV', lossless: true, sampleRate: 48000, bitDepth: 24, channels: 6 }), 'WAV · 24-bit/48 kHz · Hi-Res Lossless · 5.1');
  assert.equal(qualityLabel({ codec: 'MP3', lossless: false }), 'MP3 · Lossy');
});
