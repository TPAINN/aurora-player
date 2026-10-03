// One key per song, whatever the version: remixes, edits, labels, "(Radio Version)",
// "[Shortened]", " - KREAM Remix" and featured credits all fold into the plain title,
// so a queue or a shelf never fills with the same song over and over.
const fold = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

export function songKey(title) {
  const text = String(title || '');
  const plain = text
    .replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, ' ')
    .replace(/\s+[-–—]\s+.*$/, ' ')
    .replace(/\s(?:feat\.?|ft\.?|featuring|with)\s.*$/i, ' ');
  return fold(plain) || fold(text);
}
