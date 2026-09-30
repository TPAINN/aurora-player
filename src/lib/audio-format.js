// Reads a local file's real format from its header so quality badges state
// facts: codec, bit depth, sample rate and channels. Nothing is inferred from
// the file name alone, and lossy codecs are never called lossless.

const ascii = (bytes, at, length) => String.fromCharCode(...bytes.subarray(at, at + length));
const indexOf = (bytes, text, from = 0) => {
  const codes = [...text].map(c => c.charCodeAt(0));
  outer: for (let i = from; i <= bytes.length - codes.length; i++) {
    for (let j = 0; j < codes.length; j++) if (bytes[i + j] !== codes[j]) continue outer;
    return i;
  }
  return -1;
};

function skipId3(bytes) {
  if (ascii(bytes, 0, 3) !== 'ID3' || bytes.length < 10) return 0;
  return 10 + ((bytes[6] & 0x7f) << 21 | (bytes[7] & 0x7f) << 14 | (bytes[8] & 0x7f) << 7 | (bytes[9] & 0x7f));
}

// IEEE 754 80-bit extended, as used by AIFF sample rates.
function extended(view, at) {
  const exponent = view.getUint16(at) & 0x7fff;
  const mantissa = view.getUint32(at + 2) * 2 ** 32 + view.getUint32(at + 6);
  return Math.round(mantissa * 2 ** (exponent - 16383 - 63));
}

export function probeBytes(bytes, name = '') {
  if (!bytes || bytes.length < 4) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = skipId3(bytes);
  if (ascii(bytes, start, 4) === 'fLaC' && bytes.length >= start + 22) {
    const o = start + 18;
    return { codec: 'FLAC', lossless: true, sampleRate: (bytes[o] << 12) | (bytes[o + 1] << 4) | (bytes[o + 2] >> 4), bitDepth: ((((bytes[o + 2] & 1) << 4) | (bytes[o + 3] >> 4)) + 1), channels: ((bytes[o + 2] >> 1) & 7) + 1 };
  }
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') {
    const fmt = indexOf(bytes, 'fmt ', 12);
    if (fmt < 0 || fmt + 24 > bytes.length) return { codec: 'WAV', lossless: true };
    const format = view.getUint16(fmt + 8, true);
    return { codec: format === 3 ? 'WAV (float)' : 'WAV', lossless: true, sampleRate: view.getUint32(fmt + 12, true), bitDepth: view.getUint16(fmt + 22, true), channels: view.getUint16(fmt + 10, true) };
  }
  if (ascii(bytes, 0, 4) === 'FORM' && /^AIF[FC]$/.test(ascii(bytes, 8, 4))) {
    const comm = indexOf(bytes, 'COMM', 12);
    if (comm < 0 || comm + 26 > bytes.length) return { codec: 'AIFF', lossless: true };
    return { codec: 'AIFF', lossless: true, sampleRate: extended(view, comm + 16), bitDepth: view.getUint16(comm + 14), channels: view.getUint16(comm + 8) };
  }
  if (ascii(bytes, 4, 4) === 'ftyp') {
    const alac = indexOf(bytes, 'alac', 8);
    if (alac >= 0) {
      const cookie = indexOf(bytes, 'alac', alac + 4);
      if (cookie >= 0 && cookie + 32 <= bytes.length) {
        const base = cookie + 8;
        return { codec: 'ALAC', lossless: true, sampleRate: view.getUint32(base + 20), bitDepth: bytes[base + 5], channels: bytes[base + 9] };
      }
      return { codec: 'ALAC', lossless: true };
    }
    if (indexOf(bytes, 'mp4a', 8) >= 0) return { codec: 'AAC', lossless: false };
    return null;
  }
  if (ascii(bytes, 0, 4) === 'OggS') {
    if (indexOf(bytes, 'OpusHead') >= 0) return { codec: 'Opus', lossless: false };
    if (indexOf(bytes, '\x7fFLAC') >= 0) return { codec: 'FLAC (Ogg)', lossless: true };
    return { codec: 'Vorbis', lossless: false };
  }
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return { codec: 'WebM', lossless: false };
  if (start > 0 || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return /\.mp3$/i.test(name) || start > 0 ? { codec: 'MP3', lossless: false } : null;
  return null;
}

// Headers sit at the start; MP4 metadata may sit at the end, so read both.
export async function probeFile(file) {
  const head = new Uint8Array(await file.slice(0, 1 << 20).arrayBuffer());
  const found = probeBytes(head, file.name);
  if (found || ascii(head, 4, 4) !== 'ftyp' || file.size <= 1 << 20) return found;
  const tail = new Uint8Array(await file.slice(Math.max(0, file.size - (2 << 20))).arrayBuffer());
  const joined = new Uint8Array(head.length + tail.length); joined.set(head); joined.set(tail, head.length);
  return probeBytes(joined, file.name);
}

const LAYOUTS = { 1: 'Mono', 6: '5.1', 8: '7.1' };
export function qualityLabel(format) {
  if (!format) return '';
  if (!format.lossless) return `${format.codec} · Lossy`;
  const parts = [format.codec];
  if (format.bitDepth && format.sampleRate) parts.push(`${format.bitDepth}-bit/${Number((format.sampleRate / 1000).toFixed(1))} kHz`);
  parts.push(format.bitDepth > 16 || format.sampleRate > 48000 ? 'Hi-Res Lossless' : 'Lossless');
  const layout = LAYOUTS[format.channels] || (format.channels > 2 ? `${format.channels} ch` : '');
  if (layout) parts.push(layout);
  return parts.join(' · ');
}
