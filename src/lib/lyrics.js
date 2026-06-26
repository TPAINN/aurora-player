const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'with', 'this', 'from', 'your', 'you', 'are',
  'but', 'not', 'was', 'have', 'all', 'can', 'its', 'our', 'out', 'too',
]);

const CHORUS_TYPES = new Set(['chorus', 'hook', 'refrain']);

export function normalizeLyricText(value) {
  return (value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeLyric(value) {
  return normalizeLyricText(value)
    .split(' ')
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

function compareLyricLines(a, b) {
  if (!a || !b) return 0;

  const normA = normalizeLyricText(a);
  const normB = normalizeLyricText(b);

  if (!normA || !normB) return 0;
  if (normA === normB) return 1;
  if (normA.includes(normB) || normB.includes(normA)) return 0.93;

  const tokensA = tokenizeLyric(normA);
  const tokensB = tokenizeLyric(normB);
  if (!tokensA.length || !tokensB.length) return 0;

  const setB = new Set(tokensB);
  let shared = 0;
  for (const token of tokensA) {
    if (setB.has(token)) shared++;
  }

  const overlap = shared / Math.max(tokensA.length, tokensB.length);

  const prefixA = tokensA.slice(0, 3).join(' ');
  const prefixB = tokensB.slice(0, 3).join(' ');
  const prefixScore = prefixA && prefixA === prefixB ? 0.12 : 0;

  return Math.min(1, overlap + prefixScore);
}

function mergeRanges(ranges, mergeGap = 1.8) {
  if (!ranges.length) return [];

  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const previous = merged[merged.length - 1];

    if (current.start <= previous.end + mergeGap) {
      previous.end = Math.max(previous.end, current.end);
      continue;
    }

    merged.push({ ...current });
  }

  return merged;
}

export function getLineEndTime(line, nextLine) {
  if (!line) return 0;
  if (line.words?.length) {
    return line.words[line.words.length - 1].end;
  }

  if (nextLine?.time) {
    return Math.max(line.time + 0.15, nextLine.time - 0.12);
  }

  return line.time + 4;
}

export function findActiveLyricIndex(lyrics, time) {
  let low = 0;
  let high = lyrics.length - 1;
  let result = -1;

  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (lyrics[middle].time <= time) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return result;
}

export function getDisplayWords(line) {
  if (line?.words?.length) {
    return line.words.map((word) => word.text);
  }

  return (line?.text || '').split(/\s+/).filter(Boolean);
}

export function mapSectionsToLyricLines(syncedLyrics, structuredSections) {
  return mapSectionsToLyricLinesDetailed(syncedLyrics, structuredSections).types;
}

export function mapSectionsToLyricLinesDetailed(syncedLyrics, structuredSections) {
  if (!structuredSections?.length || !syncedLyrics?.length) {
    return {
      types: [],
      confidence: [],
      overallConfidence: 0,
    };
  }

  const sectionLines = [];
  for (const section of structuredSections) {
    for (const line of section.content) {
      sectionLines.push({
        text: normalizeLyricText(line),
        type: section.type || 'unknown',
      });
    }
  }

  const mappedTypes = new Array(syncedLyrics.length).fill('verse');
  const confidence = new Array(syncedLyrics.length).fill(0);
  let sectionPointer = 0;

  for (let lyricIndex = 0; lyricIndex < syncedLyrics.length; lyricIndex++) {
    const lyric = syncedLyrics[lyricIndex];
    const lyricText = normalizeLyricText(lyric.text);
    if (!lyricText || lyric.isGap) continue;

    let bestMatch = null;

    for (
      let scanIndex = Math.max(0, sectionPointer - 2);
      scanIndex < Math.min(sectionPointer + 10, sectionLines.length);
      scanIndex++
    ) {
      const sectionLine = sectionLines[scanIndex];
      let score = compareLyricLines(lyricText, sectionLine.text);
      if (lyricIndex > 0 && mappedTypes[lyricIndex - 1] === sectionLine.type) score += 0.04;
      if (scanIndex === sectionPointer) score += 0.03;
      if (!bestMatch || score > bestMatch.score) bestMatch = { type: sectionLine.type, score, scanIndex };
    }

    if (bestMatch && bestMatch.score >= 0.62) {
      mappedTypes[lyricIndex] = bestMatch.type;
      confidence[lyricIndex] = Math.min(1, bestMatch.score);
      sectionPointer = Math.max(sectionPointer, bestMatch.scanIndex + 1);
    } else if (lyricIndex > 0) {
      mappedTypes[lyricIndex] = mappedTypes[lyricIndex - 1];
      confidence[lyricIndex] = Math.max(confidence[lyricIndex - 1] * 0.92, 0.18);
    }
  }

  for (let i = 1; i < mappedTypes.length - 1; i++) {
    const prev = mappedTypes[i - 1];
    const curr = mappedTypes[i];
    const next = mappedTypes[i + 1];
    if (prev === next && curr !== prev && confidence[i] < 0.78) {
      mappedTypes[i] = prev;
      confidence[i] = Math.max(confidence[i - 1], confidence[i + 1]) * 0.94;
    }
  }

  const nonGapConfidence = confidence.filter((value, index) => !syncedLyrics[index]?.isGap && value > 0);
  const overallConfidence = nonGapConfidence.length
    ? nonGapConfidence.reduce((sum, value) => sum + value, 0) / nonGapConfidence.length
    : 0;

  return { types: mappedTypes, confidence, overallConfidence };
}

export function buildChorusRangesFromSections(lyrics, structuredSections) {
  const { types: lineTypes, confidence } = mapSectionsToLyricLinesDetailed(lyrics, structuredSections);
  if (!lineTypes.length) return [];

  const rawRanges = [];
  let rangeStart = -1;

  for (let index = 0; index < lineTypes.length; index++) {
    const isChorus = CHORUS_TYPES.has(lineTypes[index]) && (confidence[index] || 0) >= 0.48;
    if (isChorus && rangeStart === -1) {
      rangeStart = index;
    }

    const isEnding = rangeStart !== -1 && (!isChorus || index === lineTypes.length - 1);
    if (!isEnding) continue;

    const endIndex = isChorus && index === lineTypes.length - 1 ? index : index - 1;
    if (endIndex >= rangeStart) {
      rawRanges.push({
        start: Math.max(0, lyrics[rangeStart].time - 0.08),
        end: getLineEndTime(lyrics[endIndex], lyrics[endIndex + 1]) + 0.18,
      });
    }

    rangeStart = -1;
  }

  return mergeRanges(rawRanges).filter((range) => range.end - range.start >= 6);
}

export function detectChorusRanges(lyrics) {
  if (!lyrics?.length || lyrics.length < 8) return [];

  const filtered = lyrics
    .map((line, index) => ({
      index,
      time: line.time,
      text: normalizeLyricText(line.text),
      isGap: !!line.isGap,
    }))
    .filter((line) => !line.isGap && line.text.length >= 8);

  if (filtered.length < 6) return [];

  const songStart = filtered[0].time;
  const songEnd = filtered[filtered.length - 1].time;
  const songSpan = Math.max(songEnd - songStart, 60);
  const earlyBoundary = songStart + songSpan * 0.08;
  const repeatedIndices = new Set();

  for (let left = 0; left < filtered.length - 1; left++) {
    const base = filtered[left];
    if (base.time < earlyBoundary) continue;

    for (let right = left + 1; right < filtered.length; right++) {
      const compare = filtered[right];
      const timeGap = compare.time - base.time;
      if (timeGap < 18 || timeGap > songSpan * 0.72) continue;

      const firstScore = compareLyricLines(base.text, compare.text);
      if (firstScore < 0.76) continue;

      let chainLength = 1;
      while (
        chainLength < 4 &&
        left + chainLength < filtered.length &&
        right + chainLength < filtered.length
      ) {
        const leftLine = filtered[left + chainLength];
        const rightLine = filtered[right + chainLength];
        const chainScore = compareLyricLines(leftLine.text, rightLine.text);
        if (chainScore < 0.67) break;
        chainLength++;
      }

      if (chainLength < 2 && firstScore < 0.9) continue;

      for (let offset = 0; offset < chainLength; offset++) {
        repeatedIndices.add(filtered[left + offset].index);
        repeatedIndices.add(filtered[right + offset].index);
      }
    }
  }

  if (!repeatedIndices.size) return [];

  const ordered = [...repeatedIndices].sort((a, b) => a - b);
  const ranges = [];
  let start = ordered[0];
  let end = ordered[0];

  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i] - end <= 2) {
      end = ordered[i];
      continue;
    }

    ranges.push({
      start: Math.max(0, lyrics[start].time - 0.05),
      end: getLineEndTime(lyrics[end], lyrics[end + 1]) + 0.2,
    });
    start = ordered[i];
    end = ordered[i];
  }

  ranges.push({
    start: Math.max(0, lyrics[start].time - 0.05),
    end: getLineEndTime(lyrics[end], lyrics[end + 1]) + 0.2,
  });

  return mergeRanges(ranges).filter((range) => range.end - range.start >= 8);
}

export function detectChorusFromGeniusLyrics(lyrics, geniusLyrics) {
  if (!geniusLyrics || !lyrics?.length) return [];

  const geniusLines = geniusLyrics
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const chorusBlocks = [];
  let inChorus = false;
  let currentBlock = [];

  for (const line of geniusLines) {
    const headerMatch = line.match(/^\[(.+)\]$/);
    if (headerMatch) {
      if (inChorus && currentBlock.length) chorusBlocks.push(currentBlock);
      currentBlock = [];
      inChorus = /chorus|refrain|hook/i.test(headerMatch[1]);
      continue;
    }

    if (inChorus) {
      const normalized = normalizeLyricText(line);
      if (normalized.length >= 4) currentBlock.push(normalized);
    }
  }

  if (inChorus && currentBlock.length) chorusBlocks.push(currentBlock);
  if (!chorusBlocks.length) return [];

  const ranges = [];

  for (const block of chorusBlocks) {
    const matches = [];

    for (let lyricIndex = 0; lyricIndex < lyrics.length; lyricIndex++) {
      const lyricText = normalizeLyricText(lyrics[lyricIndex].text);
      if (!lyricText) continue;

      for (const chorusLine of block) {
        if (compareLyricLines(lyricText, chorusLine) >= 0.76) {
          matches.push(lyricIndex);
          break;
        }
      }
    }

    if (!matches.length) continue;

    let startIndex = matches[0];
    let endIndex = matches[0];

    for (let i = 1; i < matches.length; i++) {
      if (matches[i] - endIndex <= 2) {
        endIndex = matches[i];
        continue;
      }

      ranges.push({
        start: Math.max(0, lyrics[startIndex].time - 0.08),
        end: getLineEndTime(lyrics[endIndex], lyrics[endIndex + 1]) + 0.18,
      });
      startIndex = matches[i];
      endIndex = matches[i];
    }

    ranges.push({
      start: Math.max(0, lyrics[startIndex].time - 0.08),
      end: getLineEndTime(lyrics[endIndex], lyrics[endIndex + 1]) + 0.18,
    });
  }

  return mergeRanges(ranges).filter((range) => range.end - range.start >= 5);
}
