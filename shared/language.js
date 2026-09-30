// Lightweight, dependency-free language and genre signals for coherent radio.
// Detection reads real text (lyrics, titles); it never guesses from an artist name alone.

const SCRIPTS = [
  ['el', /\p{Script=Greek}/u],
  ['cyrl', /\p{Script=Cyrillic}/u],
  ['ko', /\p{Script=Hangul}/u],
  ['kana', /[\p{Script=Hiragana}\p{Script=Katakana}]/u],
  ['han', /\p{Script=Han}/u],
  ['ar', /\p{Script=Arabic}/u],
  ['he', /\p{Script=Hebrew}/u],
  ['hi', /\p{Script=Devanagari}/u],
  ['th', /\p{Script=Thai}/u],
  ['latin', /\p{Script=Latin}/u],
];

// High-frequency function words; distinctive enough to separate neighbours.
const STOPWORDS = {
  en: 'the and you i to a my me it in of that is your on we for be all with this so love baby oh just when what know don t can like was now never got are but',
  es: 'que de el la y no me te en lo mi tu es un una por con para se yo como mas pero quiero amor cuando si esta ya todo nada vida corazon',
  pt: 'que de o a e nao eu voce meu minha com um uma para em do da se me te mais mas quando tudo amor so vai sem esta pra coracao',
  fr: 'je tu de la le et les que pas un une dans est pour moi toi mon ma qui on il elle nous vous mais plus ne sur avec tout suis',
  de: 'ich du und die der das nicht ist mit mir dich ein eine es wir zu auf sie in so bin mein was wenn noch nur auch alles',
  it: 'che di e il la non io tu mi ti un una per con sei sono ma se come piu mio mia noi del della cosi quando tutto amore',
  nl: 'ik je de het een en niet is dat van wat mijn jij we op zijn maar me voor nog met als dan ook',
  tr: 've bir ben sen bu ne da de icin gibi ama cok beni seni var yok olsun ki mi diye',
  pl: 'nie i w sie to na ze jak mi ty ja jest co tak mnie ciebie juz ale do tylko',
  sv: 'jag du och att det en som inte pa med mig dig ar har vi for sa men kan',
  id: 'aku kau dan yang di ini itu tak ku cinta kita dengan untuk tidak akan hanya ada',
  ro: 'si eu tu de la nu ca pe o un mai ma te cu imi iubire sa esti',
};
const WORDS = Object.fromEntries(Object.entries(STOPWORDS).map(([lang, words]) => [lang, new Set(words.split(' '))]));

const fold = text => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

export function detectLanguage(text) {
  const value = String(text || '');
  const counts = {};
  let letters = 0;
  for (const character of value) {
    if (!/\p{L}/u.test(character)) continue;
    letters++;
    const match = SCRIPTS.find(([, pattern]) => pattern.test(character));
    const key = match ? match[0] : 'other';
    counts[key] = (counts[key] || 0) + 1;
  }
  if (letters < 3) return null;
  const share = key => (counts[key] || 0) / letters;
  // Japanese mixes kana and kanji; Han alone is Chinese.
  if (counts.kana && share('kana') + share('han') >= .35) return { lang: 'ja', confidence: share('kana') + share('han') };
  for (const [lang] of SCRIPTS) {
    if (lang === 'latin' || lang === 'kana') continue;
    // Non-Latin lyrics often carry an English hook, so a strong minority still decides.
    if (share(lang) >= .35) return { lang: lang === 'han' ? 'zh' : lang, confidence: share(lang) };
  }
  if (share('latin') < .6) return null;
  const tokens = fold(value).split(/[^\p{L}]+/u).filter(Boolean);
  if (tokens.length < 12) return null;
  const scores = Object.entries(WORDS).map(([lang, words]) => [lang, tokens.filter(token => words.has(token)).length / tokens.length]).sort((a, b) => b[1] - a[1]);
  const [[lang, best], [, second]] = scores;
  return best >= .12 && best - second >= .04 ? { lang, confidence: Math.min(1, best * 2) } : null;
}

const REGIONAL = [
  [/greek|λαϊκ|entechno|rebetiko/i, 'el'], [/k-?pop|korean/i, 'ko'], [/j-?pop|j-?rock|anime|japan|enka/i, 'ja'],
  [/mandopop|cantopop|c-?pop|chinese/i, 'zh'], [/turkish|arabesk/i, 'tr'], [/arabic|khaleeji|rai/i, 'ar'],
  [/french|chanson|variété/i, 'fr'], [/german|schlager|deutsch/i, 'de'], [/italian|canzone/i, 'it'],
  [/brazil|mpb|sertanejo|samba|pagode|bossa/i, 'pt'], [/latin|urbano|reggaeton|salsa|bachata|cumbia|flamenco|ranchera|regional mexicano/i, 'es'],
  [/russian/i, 'cyrl'], [/bollywood|hindi|indian pop/i, 'hi'],
];
export function genreLanguageHint(genre) {
  const value = String(genre || '');
  return REGIONAL.find(([pattern]) => pattern.test(value))?.[1] ?? null;
}

// Broad vibe families shared by iTunes and Deezer genre names.
const FAMILIES = [
  ['hiphop', /hip.?hop|rap|trap|drill|grime/i], ['rnb', /r&b|soul|funk|neo.?soul/i],
  ['electronic', /electr|dance|house|techno|edm|trance|dubstep|drum|garage/i], ['metal', /metal|hardcore/i],
  ['rock', /rock|punk|grunge/i], ['alternative', /alternative|indie|singer.?songwriter/i], ['jazz', /jazz|blues/i],
  ['classical', /classical|opera|orchestra|soundtrack|films|score/i], ['country', /country|americana/i],
  ['folk', /folk|acoustic|world|greek|entechno|rebetiko/i], ['latin', /latin|reggaeton|urbano|salsa|bachata|brazil|mpb|sertanejo/i],
  ['reggae', /reggae|dancehall|ska/i], ['chill', /ambient|chill|lo.?fi|new age|easy listening/i],
  ['pop', /pop|k-?pop|j-?pop|schlager|variété|chanson|asian music/i],
];
export function genreFamily(genre) {
  const value = String(genre || '');
  return FAMILIES.find(([, pattern]) => pattern.test(value))?.[0] ?? null;
}

const NEIGHBOURS = ['pop:electronic', 'pop:rnb', 'pop:alternative', 'pop:latin', 'pop:folk', 'rnb:hiphop', 'rock:alternative', 'rock:metal',
  'alternative:electronic', 'alternative:folk', 'folk:country', 'jazz:rnb', 'chill:electronic', 'chill:alternative', 'chill:classical', 'reggae:latin', 'latin:hiphop'];
const NEAR = new Set(NEIGHBOURS.flatMap(pair => [pair, pair.split(':').reverse().join(':')]));
export function compatibleFamilies(a, b) {
  return a === b || NEAR.has(`${a}:${b}`);
}
