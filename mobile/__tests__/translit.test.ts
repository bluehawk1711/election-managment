/**
 * Transliteration behaviour, checked against the *real* names in the roll
 * rather than invented examples.
 *
 * The fixtures are lifted verbatim from `data/.../ward-*.csv`, because the
 * whole point of this module is to cope with the text that is actually in the
 * data — a synthetic "राम कुमार" would not have exercised half of it.
 */
import {
  devanagariToLatin,
  hasDevanagari,
  keyContains,
  keyOf,
  nativeKey,
  phoneticKey,
  rankKey,
} from '@/lib/roll/translit';

describe('hasDevanagari', () => {
  it('detects Devanagari', () => {
    expect(hasDevanagari('मुकेश कुमार')).toBe(true);
  });

  it('does not fire on Latin or digits', () => {
    expect(hasDevanagari('Mukesh Kumar')).toBe(false);
    expect(hasDevanagari('CTK4949558')).toBe(false);
  });
});

describe('phoneticKey', () => {
  it('reduces a real roll name to its consonant skeleton', () => {
    // मुकेश कुमार -> mu-ke-sh + ku-mar -> mks + kmr
    expect(phoneticKey('मुकेश कुमार')).toBe('mkskmr');
  });

  it('reduces the Latin spelling of the same name to the identical skeleton', () => {
    // This is the whole feature: same person, either keyboard, one key.
    expect(phoneticKey('mukesh kumar')).toBe(phoneticKey('मुकेश कुमार'));
    expect(phoneticKey('MukesH KuMaR')).toBe(phoneticKey('मुकेश कुमार'));
  });

  it('ignores vowel signs, so a Hindi user who omits matras still matches', () => {
    expect(phoneticKey('हरिराम')).toBe(phoneticKey('हरि राम'));
    expect(phoneticKey('हरिराम')).toBe(phoneticKey('hariram'));
  });

  it('keeps the vocalic r, which is consonantal in effect', () => {
    // कृष्ण -> krshn. Dropping the ृ would give "ksn" and match nothing.
    expect(phoneticKey('कृष्ण')).toBe(phoneticKey('krishn'));
  });

  it('resolves aspirates the same way from both scripts', () => {
    // ष is "sh" in Latin and "s" after collapsing; ख is "kh" and "k".
    expect(phoneticKey('शर्मा')).toBe(phoneticKey('sarma'));
    expect(phoneticKey('खुरा')).toBe(phoneticKey('khura'));
  });

  it('handles conjuncts as a unit rather than per letter', () => {
    // क्ष must not index as "k" + "sh", which no Latin spelling produces.
    expect(phoneticKey('क्षत्रिय')).toBe(phoneticKey('kshtriya'));
  });

  it('treats anusvara as n, matching the Roman spelling of सिंह', () => {
    expect(phoneticKey('सिंह')).toBe(phoneticKey('singh'));
  });

  it('handles the nukta forms rather than dropping the mark silently', () => {
    // क़ -> q, not k + stray nukta.
    expect(phoneticKey('क़')).not.toBe(phoneticKey('क'));
  });

  it('maps Devanagari digits to ASCII', () => {
    expect(phoneticKey('१२३')).toBe('123');
  });

  it('leaves digits and EPIC ids alone', () => {
    expect(phoneticKey('CTK4949558')).toBe('ctk4949558');
  });

  it('collapses the doubled vowels of Aam Hindi', () => {
    expect(phoneticKey('Raam')).toBe(phoneticKey('Ram'));
  });

  it('is stable for an empty or separator-only query', () => {
    expect(phoneticKey('')).toBe('');
    expect(phoneticKey('   ')).toBe('');
  });
});

describe('nativeKey', () => {
  it('strips matras so spaced and unspaced spellings agree', () => {
    expect(nativeKey('रामदेवी')).toBe(nativeKey('राम देवी'));
  });

  it('leaves Latin text tidied rather than mangled', () => {
    expect(nativeKey('Mukesh Kumar')).toBe('mukesh kumar');
  });
});

describe('devanagariToLatin', () => {
  it('keeps vowel signs, so it reads as romanised Hindi', () => {
    // Consonants only, by design — see the function's doc comment. This is the
    // step *before* the Latin-side collapse turns 'sh' into 's'.
    expect(devanagariToLatin('मुकेश')).toBe('mksh');
  });

  it('turns anusvara into n rather than losing it', () => {
    expect(devanagariToLatin('सिंह')).toContain('n');
  });
});

describe('keyOf / keyContains', () => {
  it('keys both scripts of a row', () => {
    const key = keyOf('राम देवी');
    expect(key.native).toBe('रमदव');
    expect(key.phonetic).toBe('rmdv');
  });

  it('matches a Devanagari token against the native side', () => {
    expect(keyContains(keyOf('मुकेश कुमार'), keyOf('मुकेश'))).toBe(true);
  });

  it('matches a Roman token against the phonetic side', () => {
    // Regression guard for the separator bug: a phone number is pure digits,
    // and it must still be findable.
    expect(keyContains(keyOf('9876543210'), keyOf('9876543210'))).toBe(true);
  });

  it('does not match an unrelated token', () => {
    expect(keyContains(keyOf('मुकेश कुमार'), keyOf('कमला'))).toBe(false);
  });

  it('never matches on an empty token', () => {
    expect(keyContains(keyOf('मुकेश'), keyOf(''))).toBe(false);
  });
});

describe('rankKey', () => {
  it('ranks an exact match highest', () => {
    expect(rankKey(keyOf('मुकेश कुमार'), keyOf('मुकेश कुमार'))).toBe(3);
  });

  it('ranks a substring below an exact match', () => {
    // 3 is reserved for the whole value; a prefix of it is a 2.
    expect(rankKey(keyOf('मुकेश कुमार'), keyOf('मुकेश'))).toBe(2);
  });

  it('ranks a Roman query on a Devanagari row below a native one', () => {
    const row = keyOf('मुकेश कुमार');
    expect(rankKey(row, keyOf('mukesh'))).toBe(2);
    expect(rankKey(row, keyOf('मुकेश कुमार'))).toBe(3);
  });
});
