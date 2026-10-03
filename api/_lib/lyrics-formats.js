import { XMLParser } from 'fast-xml-parser';
import { inflateSync } from 'node:zlib';
const MAX_TEXT = 400000;
const decode = value => String(value).replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, entity => {
  const named = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
  if (named[entity]) return named[entity];
  const number = entity[2].toLowerCase() === 'x' ? parseInt(entity.slice(3,-1),16) : Number(entity.slice(2,-1));
  return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : '';
});
export function seconds(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return NaN;
  const text = String(value);
  if (/^\d+(\.\d+)?ms$/.test(text)) return parseFloat(text) / 1000;
  if (/^\d+(\.\d+)?s$/.test(text)) return parseFloat(text);
  if (!/^\d+(?::\d+){0,2}(?:\.\d+)?$/.test(text)) return NaN;
  return text.split(':').reduce((total, part) => total * 60 + Number(part), 0);
}
// Lyric files often open with the song's header and credits ("作词 : X",
// "Lyrics by X", "Producer: X") and close with a rights notice. They are not sung,
// so they are dropped; every remaining line keeps its own timing untouched.
const ROLE = 'lyrics? by|words by|作词|作曲|编曲|词|曲|填词|谱曲|制作人|制作|监制|出品|出品人|发行|企划|统筹|策划|混音|缩混|母带|录音|录音师|和声|和音|配唱|演唱|原唱|翻唱|吉他|电吉他|贝斯|鼓|键盘|弦乐|钢琴|编程|人声|op|sp|lyrics?|lyricist|writers?|written by|composers?|composed by|music|music by|arrangers?|arranged by|arrangement|producers?|produced by|executive producer|co-producer|mix(?:ed)?(?: by)?|mixing(?: engineer)?|master(?:ed|ing)?(?: by| engineer)?|engineers?|recording(?: engineer)?|recorded by|vocals? by|background vocals|programming|publisher|label|copyright';
const CREDIT = new RegExp(`^\\s*(?:${ROLE})\\s*[:：]\\s*\\S`, 'iu');
const CREDIT_BY = /^\s*(?:lyrics|words|written|composed|produced|mixed|mastered|arranged|recorded|music)\s+by\s+\S/i;
const NOTICE = /未经.{0,12}许可|不得翻唱|翻唱翻录|著作权|版权所有|本作品|TME享有|QQ音乐|酷狗|网易云|文曲大模型/u;
const fold = value => String(value || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '');
function isHeader(text, meta) {
  if (!meta?.title) return false;
  const [left, ...rest] = text.split(/\s+[-–—]\s+/);
  if (!rest.length) return false;
  const title = fold(rest.join(' ')), wanted = fold(meta.title);
  if (!title || !(title === wanted || wanted.startsWith(title) || title.startsWith(wanted))) return false;
  const artist = fold(meta.artist);
  return left.split(/[^\p{L}\p{N}]+/u).some(token => token.length > 1 && artist.includes(fold(token)));
}
const isCredit = text => CREDIT.test(text) || CREDIT_BY.test(text) || NOTICE.test(text);
function stripCredits(lines, meta) {
  let leading = true;
  return lines.filter(line => {
    const text = line.text.trim();
    if (isCredit(text)) return false;
    if (leading && isHeader(text, meta)) return false;
    leading = false;
    return true;
  });
}
function finish(lines, source, duration = 0, meta = null) {
  const valid = stripCredits(lines.filter(line => typeof line.text === 'string' && line.text.trim() && Number.isFinite(line.time) && line.time >= 0 && line.time <= 86400).sort((a,b) => a.time-b.time), meta).slice(0,2000);
  valid.forEach((line,index) => {
    line.text = line.text.trim().slice(0,4000);
    if (!Number.isFinite(line.end) || line.end <= line.time) line.end = Math.max(line.time, valid[index+1]?.time ?? duration);
    if (line.words) {
      line.words = line.words.filter(word => typeof word.text === 'string' && Number.isFinite(word.start) && Number.isFinite(word.end) && word.start >= line.time && word.end >= word.start && word.end <= 86400).slice(0,1000);
      if (!line.words.length) delete line.words;
    }
  });
  return valid.length ? { source, sync: valid.some(line => line.words?.length) ? 'word' : 'line', lines: valid } : null;
}
export function parseTtml(xml, source, duration, meta) {
  if (typeof xml !== 'string' || xml.length > MAX_TEXT || /<!DOCTYPE|<!ENTITY/i.test(xml)) return null;
  const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, trimValues: false, processEntities: false, parseTagValue: false });
  const tree = parser.parse(xml);
  const lines = [];
  function walk(nodes, depth = 0, line = null, word = null) {
    if (depth > 32 || !Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (node['#text'] !== undefined) {
        const text = decode(node['#text']);
        if (line) line.text += text;
        if (word) word.text += text;
        else if (line?.words.length && /^\s+$/.test(text)) line.words.at(-1).text += text;
        continue;
      }
      const tag = Object.keys(node).find(key => key !== ':@');
      const local = tag?.split(':').pop();
      const attrs = node[':@'] || {};
      if (['x-translation','x-roman'].includes(attrs['@_ttm:role'])) continue;
      if (local === 'p') {
        const next = { time: seconds(attrs['@_begin']), end: seconds(attrs['@_end']), text: '', words: [] };
        walk(node[tag],depth+1,next);
        lines.push(next);
      } else if (local === 'span' && line && attrs['@_begin'] !== undefined) {
        const next = { start: seconds(attrs['@_begin']), end: seconds(attrs['@_end']), text: '' };
        const count = line.words.length;
        walk(node[tag],depth+1,line,next);
        if (line.words.length === count && next.text.trim()) line.words.push(next);
      } else walk(node[tag],depth+1,line,word);
    }
  }
  walk(tree);
  return finish(lines,source,duration,meta);
}
export function parseLrc(value, source, duration, meta) {
  if (typeof value !== 'string' || value.length > MAX_TEXT) return null;
  const lines = [];
  let wordCount = 0;
  for (const row of decode(value).split('\n')) {
    const stamps = [...row.matchAll(/\[(\d+:\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    const content = row.slice(stamps.at(-1).index + stamps.at(-1)[0].length);
    const marks = [...content.matchAll(/<(\d+:\d+(?:\.\d+)?)>([^<]*)/g)];
    // Bound repeated timestamp expansion before cloning provider-controlled words.
    wordCount += stamps.length * marks.length;
    if (lines.length + stamps.length > 2000 || marks.length > 1000 || wordCount > 20000) return null;
    const words = marks.map((mark,index) => ({ text: mark[2], start: seconds(mark[1]), end: seconds(marks[index+1]?.[1]) })).filter(word => word.text.trim());
    const explicitEnd = marks.length && !marks.at(-1)[2].trim() ? seconds(marks.at(-1)[1]) : NaN;
    for (const stamp of stamps) lines.push({ time: seconds(stamp[1]), text: content.replace(/<[^>]*>/g,''), ...(words.length ? { words: words.map(word => ({ ...word })), end: explicitEnd } : {}) });
  }
  lines.sort((a,b) => a.time-b.time);
  lines.forEach((line,index) => {
    const lastWord = line.words?.at(-1);
    // Enhanced LRC may supply a final word start without an end marker.
    if (lastWord && !Number.isFinite(lastWord.end)) lastWord.end = Math.max(lastWord.start, lines[index+1]?.time ?? duration ?? lastWord.start);
  });
  return finish(lines,source,duration,meta);
}
export function parsePlus(data, source, duration, meta) {
  if (!Array.isArray(data?.lyrics)) return null;
  return finish(data.lyrics.slice(0,2000).filter(line => line && typeof line === 'object').map(line => ({
    time: Number(line.time)/1000, end: (Number(line.time)+Number(line.duration))/1000, text: line.text,
    words: Array.isArray(line.syllabus) ? line.syllabus.slice(0,1000).filter(Boolean).map(word => ({ text: word.text, start: Number(word.time)/1000, end: (Number(word.time)+Number(word.duration))/1000 })) : undefined,
  })),source,duration,meta);
}
export function parseTrack(data, source, duration, meta) {
  if (!data || typeof data !== 'object') return null;
  const synced = parseLrc(data.richSyncLyrics || data.syncedLyrics,source,duration,meta);
  if (synced) return synced;
  if (data.instrumental === true) return { source, sync: 'plain', lines: [], instrumental: true };
  if (typeof data.plainLyrics === 'string' && data.plainLyrics.trim() && data.plainLyrics.length <= MAX_TEXT) return { source, sync: 'plain', lines: [], plainLyrics: data.plainLyrics };
  return null;
}

// KuGou KRC: "krc1" + XOR-obfuscated zlib stream (a published, fixed key).
const KRC_KEY = [64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105];
export function decodeKrc(base64) {
  try {
    const bytes = Buffer.from(String(base64 || ''), 'base64');
    if (bytes.length < 5 || bytes.length > MAX_TEXT || bytes.subarray(0, 4).toString('latin1') !== 'krc1') return null;
    const body = Buffer.from(bytes.subarray(4));
    for (let i = 0; i < body.length; i++) body[i] ^= KRC_KEY[i % KRC_KEY.length];
    const text = inflateSync(body, { maxOutputLength: MAX_TEXT }).toString('utf8');
    return text.length <= MAX_TEXT ? text : null;
  } catch { return null; }
}

// "[lineStartMs,lineDurMs]<offsetMs,durMs,0>word…" with offsets relative to the line.
export function parseKrc(text, source, duration, meta) {
  if (typeof text !== 'string' || text.length > MAX_TEXT) return null;
  const lines = [];
  for (const row of text.split(/\r?\n/).slice(0, 4000)) {
    const head = row.match(/^\[(\d+),(\d+)\](.*)$/);
    if (!head) continue;
    const start = Number(head[1]) / 1000, length = Number(head[2]) / 1000;
    const words = [...head[3].matchAll(/<(\d+),(\d+),\d+>([^<]*)/g)].slice(0, 1000)
      .map(([, offset, span, word]) => ({ text: word, start: start + Number(offset) / 1000, end: start + (Number(offset) + Number(span)) / 1000 }))
      .filter(word => word.text);
    const plain = words.length ? words.map(word => word.text).join('') : head[3];
    lines.push({ time: start, end: start + length, text: plain, ...(words.length ? { words } : {}) });
  }
  return finish(lines, source, duration, meta);
}
