import test from 'node:test';
import assert from 'node:assert/strict';
import { detectLanguage, genreLanguageHint, genreFamily } from './language.js';

test('scripts identify non-Latin languages even with an English hook', () => {
  assert.equal(detectLanguage('Σ\'αγαπώ και σε θέλω πολύ, baby tonight').lang, 'el');
  assert.equal(detectLanguage('사랑해 너를 사랑해 oh yeah').lang, 'ko');
  assert.equal(detectLanguage('夜に駆ける 君の声が').lang, 'ja');
  assert.equal(detectLanguage('我爱你 月亮代表我的心').lang, 'zh');
  assert.equal(detectLanguage('Я люблю тебя').lang, 'cyrl');
  assert.equal(detectLanguage('حبيبي يا نور العين').lang, 'ar');
});

test('Latin lyrics are classified by function words, short titles stay unknown', () => {
  assert.equal(detectLanguage('I feel it in my heart and you know that I will never let you go, baby, when the night is over we are gone').lang, 'en');
  assert.equal(detectLanguage('Yo no sé qué me pasa contigo, pero cuando te veo me muero por ti y no quiero que te vayas de mi lado').lang, 'es');
  assert.equal(detectLanguage('Eu não sei o que fazer com você, meu amor, quando você está aqui comigo tudo fica bem para mim').lang, 'pt');
  assert.equal(detectLanguage('Je ne sais pas pourquoi tu es parti, mais dans mon cœur il y a toujours une place pour toi et moi').lang, 'fr');
  assert.equal(detectLanguage('Ich weiß nicht, was du mit mir machst, aber wenn du bei mir bist, ist alles gut und ich bin nicht allein').lang, 'de');
  assert.equal(detectLanguage('Io non so perché ma quando sei con me il mondo è più bello e la notte non finisce mai per noi').lang, 'it');
  assert.equal(detectLanguage('Blinding Lights'), null);
  assert.equal(detectLanguage(''), null);
});

test('regional catalogue genres give a weak language hint and genre families group vibes', () => {
  assert.equal(genreLanguageHint('Greek'), 'el');
  assert.equal(genreLanguageHint('K-Pop'), 'ko');
  assert.equal(genreLanguageHint('Pop'), null);
  assert.equal(genreFamily('Hip-Hop/Rap'), genreFamily('Rap/Hip Hop'));
  assert.equal(genreFamily('R&B/Soul'), genreFamily('Soul & Funk'));
  assert.equal(genreFamily('Electronic'), genreFamily('Dance'));
  assert.notEqual(genreFamily('Metal'), genreFamily('Pop'));
  assert.equal(genreFamily('Unknown thing'), null);
});

test('neighbouring genre families are compatible, distant ones are not', async () => {
  const { compatibleFamilies } = await import('./language.js');
  assert.equal(compatibleFamilies('pop', 'pop'), true);
  assert.equal(compatibleFamilies('pop', 'electronic'), true);
  assert.equal(compatibleFamilies('rock', 'alternative'), true);
  assert.equal(compatibleFamilies('pop', 'metal'), false);
  assert.equal(compatibleFamilies('classical', 'hiphop'), false);
});
