// Lyric timing checked against the playing video's own captions.
//
// Lyrics are timed for one edit of a song; the YouTube upload that plays may be
// another (a music video's intro, a different master). Its caption track (speech
// recognition or official lyric captions) is timed from that upload's audio. When
// the same three-word phrases appear in both, the time between them is the offset,
// and only a consistent one is trusted: at least six phrases from three or more
// lines agreeing within ±0.4 s. Anything less returns null and nothing changes.

const WINDOW = 12; // the largest believable shift, in seconds
const AGREE = 0.4;
const MIN_MATCHES = 6;
const MIN_LINES = 3;

const normalize = text => String(text || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const tokens = text => String(text || '').replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').split(/\s+/).map(normalize).filter(Boolean);

// json3 caption events → words with absolute start times (seconds).
export function parseCaptionWords(data) {
  const words = [];
  for (const event of Array.isArray(data?.events) ? data.events : []) {
    if (!Number.isFinite(event?.tStartMs) || !Array.isArray(event.segs)) continue;
    for (const seg of event.segs) {
      const start = (event.tStartMs + (Number.isFinite(seg?.tOffsetMs) ? seg.tOffsetMs : 0)) / 1000;
      for (const text of tokens(seg?.utf8)) words.push({ text, start });
    }
  }
  return words;
}

// Every timed three-word phrase in the lyrics: word-timed lines give each word's
// start; line-timed lines only their first word's (the line's time).
function lyricAnchors(lines) {
  const anchors = [];
  (Array.isArray(lines) ? lines : []).forEach((line, index) => {
    const words = Array.isArray(line?.words) && line.words.length ? line.words : null;
    const list = words ? words.map(word => ({ text: tokens(word.text).join(''), start: word.start })) : tokens(line?.text).map((text, i) => ({ text, start: i === 0 ? line?.time : null }));
    const clean = list.filter(word => word.text);
    for (let i = 0; i + 2 < clean.length; i++) {
      if (!Number.isFinite(clean[i].start)) continue;
      anchors.push({ key: `${clean[i].text} ${clean[i + 1].text} ${clean[i + 2].text}`, start: clean[i].start, line: index });
    }
  });
  return anchors;
}

export function alignToCaptions(lines, captionWords) {
  if (!Array.isArray(captionWords) || captionWords.length < 3) return null;
  const heard = new Map();
  for (let i = 0; i + 2 < captionWords.length; i++) {
    const key = `${captionWords[i].text} ${captionWords[i + 1].text} ${captionWords[i + 2].text}`;
    if (!heard.has(key)) heard.set(key, []);
    heard.get(key).push(captionWords[i].start);
  }
  const shifts = [];
  for (const anchor of lyricAnchors(lines))
    for (const start of heard.get(anchor.key) || []) {
      const shift = start - anchor.start;
      if (Math.abs(shift) <= WINDOW) shifts.push({ shift, line: anchor.line });
    }
  if (shifts.length < MIN_MATCHES) return null;
  shifts.sort((a, b) => a.shift - b.shift);
  // The densest ±0.4 s cluster of shifts.
  let best = [];
  for (let from = 0, to = 0; from < shifts.length; from++) {
    while (to < shifts.length && shifts[to].shift - shifts[from].shift <= 2 * AGREE) to++;
    if (to - from > best.length) best = shifts.slice(from, to);
  }
  const lineCount = new Set(best.map(item => item.line)).size;
  if (best.length < MIN_MATCHES || lineCount < MIN_LINES || best.length < 0.4 * shifts.length) return null;
  const middle = best[Math.floor(best.length / 2)].shift;
  // Lyric time = playback time + offset; captions mark playback time.
  return { offset: Math.round(-middle * 100) / 100, matches: best.length, lines: lineCount };
}

// Lyrics plus, when the captions agree, their alignment. Captions are fetched in
// parallel; once the lyrics are ready they wait at most `wait` ms for them.
export async function withAlignment(lyricsRequest, captionsRequest, { wait = 1500 } = {}) {
  const lyrics = await lyricsRequest;
  if (!captionsRequest || !lyrics?.lines?.length || lyrics.sync === 'plain') return lyrics;
  let timer;
  const captions = await Promise.race([
    Promise.resolve(captionsRequest).catch(() => null),
    new Promise(resolve => { timer = setTimeout(resolve, wait, null); }),
  ]);
  clearTimeout(timer);
  const alignment = alignToCaptions(lyrics.lines, parseCaptionWords(captions));
  return alignment ? { ...lyrics, alignment } : lyrics;
}
