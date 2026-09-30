import { XMLParser } from 'fast-xml-parser';
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
function finish(lines, source, duration = 0) {
  const valid = lines.filter(line => typeof line.text === 'string' && line.text.trim() && Number.isFinite(line.time) && line.time >= 0 && line.time <= 86400).slice(0,2000).sort((a,b) => a.time-b.time);
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
export function parseTtml(xml, source, duration) {
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
  return finish(lines,source,duration);
}
export function parseLrc(value, source, duration) {
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
  return finish(lines,source,duration);
}
export function parsePlus(data, source, duration) {
  if (!Array.isArray(data?.lyrics)) return null;
  return finish(data.lyrics.slice(0,2000).filter(line => line && typeof line === 'object').map(line => ({
    time: Number(line.time)/1000, end: (Number(line.time)+Number(line.duration))/1000, text: line.text,
    words: Array.isArray(line.syllabus) ? line.syllabus.slice(0,1000).filter(Boolean).map(word => ({ text: word.text, start: Number(word.time)/1000, end: (Number(word.time)+Number(word.duration))/1000 })) : undefined,
  })),source,duration);
}
export function parseTrack(data, source, duration) {
  if (!data || typeof data !== 'object') return null;
  const synced = parseLrc(data.richSyncLyrics || data.syncedLyrics,source,duration);
  if (synced) return synced;
  if (data.instrumental === true) return { source, sync: 'plain', lines: [], instrumental: true };
  if (typeof data.plainLyrics === 'string' && data.plainLyrics.trim() && data.plainLyrics.length <= MAX_TEXT) return { source, sync: 'plain', lines: [], plainLyrics: data.plainLyrics };
  return null;
}
