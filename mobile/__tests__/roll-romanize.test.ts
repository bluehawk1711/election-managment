/**
 * The English copy of the roll (`lib/roll/romanize.ts`).
 *
 * Fixtures are real names from `data/.../ward-*.csv`, because the module's
 * whole job is to produce a string a karykarta will actually type. Each
 * expectation was verified against the generated `assets/roll/*.json` — the
 * assertions below are the contract `scripts/generate-ward-bundles.ts`
 * depends on when it bakes the copy into the bundles.
 */
import { hasDevanagari, romanize, titleCase } from '@/lib/roll/romanize';

describe('romanize', () => {
  it('passes Latin and empty input through untouched', () => {
    expect(romanize('Mukesh Kumar')).toBe('Mukesh Kumar');
    expect(romanize('CTK4949558')).toBe('CTK4949558');
    expect(romanize('')).toBe('');
  });

  it('romanises real roll names', () => {
    expect(romanize('अर्जुन शर्मा')).toBe('arjun sharma');
    expect(romanize('मुकेश कुमार')).toBe('mukesh kumar');
    expect(romanize('कमला देवी')).toBe('kamala devi');
    expect(romanize('हरिराम')).toBe('hariram');
    expect(romanize('दयाल सिंह')).toBe('dayal singh');
  });

  it('drops the word-final schwa but keeps a real final vowel', () => {
    // मुकेश ends on an inherent vowel → "Mukesh", not "Mukesha"…
    expect(romanize('मुकेश')).toBe('mukesh');
    // …while शर्मा's final a comes from the matra ा and must survive.
    expect(romanize('शर्मा')).toBe('sharma');
    expect(romanize('तोष')).toBe('tosh');
  });

  it('nasalises anusvara by the sound that follows', () => {
    // Before ह: ng — "Singh", not "Sinh".
    expect(romanize('सिंह')).toBe('singh');
    // Before a labial: m — "Mumbai", not "MumbaI"/"Munbai".
    expect(romanize('मुंबई')).toBe('mumbai');
    // Default: n.
    expect(romanize('संतोष')).toBe('santosh');
    // The lookahead must not consume the following consonant.
    expect(romanize('अंबेडकर')).toBe('ambedakar');
  });

  it('folds conjuncts and vocalic r to their Latin spellings', () => {
    expect(romanize('ज्ञान')).toBe('gyan');
    expect(romanize('कृष्ण')).toBe('krishn');
    // A matra on a folded cluster still becomes a vowel (no Devanagari leak).
    expect(romanize('ज्ञा')).toBe('gya');
    expect(romanize('ान')).toBe('an');
  });

  it('keeps aspiration and nukta letters', () => {
    expect(romanize('खुरा')).toBe('khura');
    expect(romanize('बड़ा')).toBe('bada');
    expect(romanize('ढ़ाग')).toBe('dhag');
  });

  it('maps Devanagari digits to ASCII', () => {
    expect(romanize('०१२३')).toBe('0123');
  });

  it('leaves no Devanagari behind, ever', () => {
    // The safety net: a table miss must lose the letter, not leak a combining
    // mark into a field a Latin query is typed against.
    const inputs = [
      'रामेश्वर चौधरी',
      'बाबा रामदेव नगर,सांगरिया',
      'पारसकंवर',
      'अंबेडकर',
      'ज्ञान कुमार',
      'सिंह',
      'कृष्ण',
    ];
    for (const input of inputs) {
      expect(romanize(input)).not.toMatch(/[ऀ-ॿ]/);
    }
  });
});

describe('titleCase', () => {
  it('capitalises each word of a romanised name', () => {
    expect(titleCase('arjun sharma')).toBe('Arjun Sharma');
    expect(titleCase('ramesh singh')).toBe('Ramesh Singh');
  });

  it('capitalises after commas, which localities use as separators', () => {
    expect(titleCase('baba ramadev nagar,sangariya')).toBe(
      'Baba Ramadev Nagar,Sangariya'
    );
  });

  it('is idempotent', () => {
    const once = titleCase('ramesh kumar joshi');
    expect(titleCase(once)).toBe(once);
  });
});

describe('hasDevanagari', () => {
  it('gates Latin input off the whole pipeline', () => {
    expect(hasDevanagari('रमेश')).toBe(true);
    expect(hasDevanagari('Ramesh')).toBe(false);
    expect(hasDevanagari('123')).toBe(false);
  });
});
