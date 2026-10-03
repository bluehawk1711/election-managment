/**
 * Devanagari ⇄ Latin phonetic matching for the roll search.
 *
 * ## The problem
 *
 * The roll is 6,855 rows of Hindi text. A karykarta standing in a lane types
 * what is on the voter's ID card or what the local MLA's volunteer called out,
 * and the two are not the same alphabet:
 *
 * - Hindi keyboard → Devanagari: `रामदेवी` finds `राम देवी`, but not
 *   `रामदेवी` if the user typed `ramdevi`.
 * - Latin keyboard → Roman: `ramdevi` matches nothing at all today, because the
 *   haystack is Devanagari and `includes()` is a byte comparison.
 * - Either keyboard, vowel signs omitted: `राम` vs `रम`, and `krishn` vs
 *   `कृष्ण`, which are the same person to a human and different strings to a
 *   computer.
 *
 * ## Why this is not a translation, and why there is no English copy
 *
 * The obvious-looking fix is to keep an English/transliterated *column* beside
 * every name and search that. It was rejected deliberately:
 *
 * 1. **Transliteration ≠ translation.** `रामदेवी` has no English form. It is
 *    "Ramdevi" only under a romanisation scheme, and India has several
 *    incompatible ones (IAST `rāma-devī`, "Aam Hindi" `raamdevee`, Hunterian
 *    `Ram Dabi`). Any single one stored in Firestore is a guess, and a guess
 *    baked into 6,855 documents is a guess nobody can correct without a
 *    re-import.
 * 2. **Derived data in the database rots.** It has to be regenerated on every
 *    edit, is written by the client or a migration script, and can drift out of
 *    step with the source. Here it is derived in memory at index time from the
 *    same row that is being displayed, so it cannot be stale.
 * 3. **It is not free, and it is not data.** It costs one regex pass over a
 *    name, once, when the ward loads. Storing it costs a read, a write, a
 *    composite index if anyone ever queries it server-side, and 6,855 chances
 *    to get it wrong.
 *
 * So nothing is stored. Instead both sides of the comparison — the query the
 * user typed and the row on the device — are reduced to the **same** canonical
 * skeleton, and compared. The symmetry is the point: neither side is
 * privileged, so a Hindi query, a Roman query and a matra-less query all
 * converge on one form and match.
 *
 * ## The skeleton
 *
 * A consonant-only romanisation:
 *
 * - every Devanagari consonant maps to its base Latin consonant, with
 *   aspiration collapsed (`ख`→`kh`→`k`, `ष`→`sh`→`s`, `छ`→`ch`→`c`);
 * - vowel signs (matras) are dropped, because Hindi typing routinely omits them
 *   and because a vowel is the least reliable part of a name — except the
 *   vocalic *r* (`ृ`/`ॄ`), which is consonantal in effect and is kept, so
 *   `कृष्ण` and `krishn` agree;
 * - anusvara / candrabindu (`ं`/`ँ`) become `n`, which is what both spellings
 *   actually pronounce (`सिंह`→`sn`, `singh`→`sn`);
 * - on the Latin side, the matching collapses happen in reverse: `sh`→`s`,
 *   `ch`→`c`, `th`→`t`, `ph`→`f`, `kh`→`k`, `ng`→`n`, `z`→`j`, and vowels are
 *   dropped.
 *
 * `रामदेवी` → `rdv`; `ramdevi` → `rdv`; `राम देवी` → `rdv`. Match.
 *
 * ## Known limits, stated rather than hidden
 *
 * - It is phonetic, not semantic: `kmr` (from `kumar`/`कुमार`) will also match
 *   a name whose letters happen to run k-m-r. That is inherent to dropping
 *   vowels, and it is why `rankOf` below exists — exact and native matches are
 *   sorted above phonetic ones, so the right person is still at the top.
 * - Schwa deletion (Hindi writes most words as if the final schwa were absent)
 *   is *helped* here by dropping matras, which is the same effect, but
 *   `कमल` and `कमला` genuinely collapse to `kml`. Acceptable: the roll's real
 *   discriminator is the EPIC number, which is digits and always exact.
 * - Non-Hindi scripts (Urdu, Gujarati, Tamil) pass through untouched. They are
 *   still searchable by exact substring, just not phonetically.
 */


/**
 * Devanagari consonant → Latin skeleton, with aspiration written as a trailing
 * `h`. The `h` is stripped at the end of the pass, so `ख`/`घ`/`ष` collapse onto
 * `क`/`ग`/`स` — the same thing the Latin side does with `kh`/`gh`/`sh`. Both
 * paths therefore land in the same place, which is what makes them match.
 *
 * Ordered longest-first at use time (see `mapConsonants`), because the conjuncts
 * (`क्ष`, `त्र`, `श्र`) must win over their first letter.
 */
const CONSONANT: Record<string, string> = {
  // velars
  क: 'k',
  ख: 'kh',
  ग: 'g',
  घ: 'gh',
  ङ: 'ng',
  // palatals
  च: 'c',
  छ: 'ch',
  ज: 'j',
  झ: 'jh',
  ञ: 'n',
  // retroflexes
  ट: 't',
  ठ: 'th',
  ड: 'd',
  ढ: 'dh',
  ण: 'n',
  // dentals
  त: 't',
  थ: 'th',
  द: 'd',
  ध: 'dh',
  न: 'n',
  // labials
  प: 'p',
  फ: 'ph',
  ब: 'b',
  भ: 'bh',
  म: 'm',
  // semivowels
  य: 'y',
  र: 'r',
  ल: 'l',
  व: 'v',
  // sibilants + h
  श: 'sh',
  ष: 'sh',
  स: 's',
  ह: 'h',
  // rare
  ळ: 'l',
  ऴ: 'l',
  // nasals that are also letters
  ऱ: 'r',
};

/**
 * Conjuncts that must be matched before their leading consonant, or `क्ष`
 * would index as `k` + `sh` and `ज्ञ` as `j`, producing skeletons no Latin
 * spelling would ever produce.
 */
const CONJUNCT: Record<string, string> = {
  क्ष: 'ksh',
  त्र: 'tr',
  ज्ञ: 'gy',
  श्र: 'shr',
  द्व: 'dw',
  ह्म: 'hm',
  ह्म्म: 'hmm',
  त्त: 'tt',
  त्त्त: 'ttt',
  न्न: 'nn',
  ल्ल: 'll',
  स्त: 'st',
  स्थ: 'sth',
  न्त: 'nt',
  न्द: 'nd',
  म्प: 'mp',
  म्ब: 'mb',
  म्य: 'my',
  व्य: 'vy',
  क्त: 'kt',
  क्र: 'kr',
  ग्र: 'gr',
  प्र: 'pr',
  ब्र: 'br',
  द्र: 'dr',
  स्व: 'sv',
};

/**
 * Vowel signs that vanish. Kept as an explicit list (rather than "anything not
 * in the consonant table") so that a character added to Devanagari later fails
 * loudly in a test instead of silently becoming searchable text.
 */
const DROPPED_SIGNS =
  /[ािीुूॅेैॉोौःऀँंः॒॑ऺऻ़ऩप़फ़बड़ढ़ॊोौ्ॎॏॐ॒॑॓॔ॕॖॗ]/g;

/**
 * Anusvara / candrabindu.
 *
 * Not a vowel, despite sitting where one goes: it nasalises the preceding
 * consonant, and both scripts agree it is an n — `सिंह` is "singh", `संत` is
 * "sant". Dropping it outright was the single largest source of Hindi/Roman
 * mismatch: it produced `s` where the Latin spelling produced `sn`.
 *
 * `nativeKey` normalises it to one `ं` so the native form stays valid-looking;
 * `devanagariToLatin` maps it to `n` before matras are stripped.
 */
const ANUSVARA = /[ंँ]/g;

/** The two that survive: vocalic r is consonantal in effect. */
const VOCALIC_R = /[ृॄ]/g;

/** Independent vowels — dropped, same reasoning as the matras above. */
const INDEPENDENT_VOWELS = /[अआइईउऊऋएऐओऔऍऎएऐऑऒओऔ]/g;

/** Devanagari digits → ASCII, so `१२३` and `123` agree. */
const DIGITS = /[०-९]/g;

/**
 * Latin digraphs → their base consonant. Mirrors the Devanagari side exactly.
 *
 * Order is significant and handled by `String.replace` scanning left to right
 * over a single alternation, so `sh` cannot be read as `s` followed by `h`.
 */
const LATIN_DIGRAPHS =
  /ksh|sh|ch|th|ph|kh|gh|jh|bh|dh|ng|ck|qu|dz|tt|ss|zz|aa|ee|ii|oo|uu|ri/g;

const LATIN_DIGRAPH_MAP: Record<string, string> = {
  ksh: 'ks',
  sh: 's',
  ch: 'c',
  th: 't',
  ph: 'f',
  kh: 'k',
  gh: 'g',
  jh: 'j',
  bh: 'b',
  dh: 'd',
  ng: 'n',
  ck: 'k',
  qu: 'k',
  dz: 'z',
  tt: 't',
  ss: 's',
  zz: 'z',
  // Common doubled vowels: `Raam` / `Sitaa` in "Aam Hindi" collapse to the
  // single vowel, matching `Ram` / `Sita`.
  aa: 'a',
  ee: 'i',
  ii: 'i',
  oo: 'u',
  uu: 'u',
  // `Kri` / `Shri` written with an explicit i after the consonant.
  ri: 'r',
};

/** Single Latin letters that differ from their skeleton equivalent. */
const LATIN_LETTERS: Record<string, string> = {
  z: 'j',
  x: 'ks',
  w: 'v',
  y: 'y',
  c: 'c',
  q: 'k',
};

/**
 * Nukta letters — consonants whose nukta marks a genuinely different sound
 * rather than an aspirated version of the base.
 *
 * These have to be matched as units *before* the nukta is stripped, or `क़`
 * silently becomes `क` and the two collapse. Aspirated letters (ख, ड़-style
 * softness) do collapse on purpose; the uvulars do not, because no Roman
 * spelling of a `q` is going to be written `k`.
 */
const NUKTA_LETTERS: Record<string, string> = {
  क़: 'q',
  ख़: 'kh',
  ग़: 'gh',
  ज़: 'z',
  ड़: 'r',
  ढ़: 'rh',
  फ़: 'f',
  ऱ: 'r',
  ऴ: 'l',
};

/** True when the text contains any Devanagari code point. */
export function hasDevanagari(text: string): boolean {
  return /[ऀ-ॿ]/.test(text);
}

/** Lowercase, drop punctuation and whitespace runs. */
function tidy(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The native form: Devanagari with its vowel signs and punctuation removed,
 * so `राम देवी` and `रामदेवी` and `राम-देवी` are one string. Non-Devanagari
 * text passes through tidied.
 */
export function nativeKey(text: string): string {
  // Spaces are removed, not collapsed: `रामदेवी` and `राम देवी` are one word
  // written two ways, and the whole point of the native key is that those
  // agree. Keeping the space made the two forms incomparable by `includes`.
  const tidied = tidy(text);
  if (!hasDevanagari(tidied)) return tidied;

  return (
    tidied
      .replace(DIGITS, (digit) => String(digit.charCodeAt(0) - 0x0966))
      .replace(/़/g, '')
      .replace(ANUSVARA, 'ं')
      .replace(DROPPED_SIGNS, '')
      .replace(VOCALIC_R, 'र')
      // A standalone anusvara now looks like a leftover mark; drop it.
      .replace(/ं+/g, '')
      // `tidy` left single spaces between words; the native key is one blob.
      .replace(/\s+/g, '')
      .trim()
  );
}

/**
 * The phonetic form. Runs whichever path the text needs — Devanagari is mapped
 * out to Latin first, then *both* go through the same Latin collapsing, so the
 * two scripts are guaranteed to be compared in the same alphabet.
 */
export function phoneticKey(text: string): string {
  const base = hasDevanagari(text) ? devanagariToLatin(text) : text;
  return tidy(base)
    .replace(LATIN_DIGRAPHS, (matched) => LATIN_DIGRAPH_MAP[matched] ?? matched)
    .replace(/[aeiouAEIOU]/g, '')
    .replace(/[hH]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Devanagari → its Latin consonants. An intermediate step, exported for tests.
 *
 * It does **not** produce romanised Hindi with vowels (that would be "mukes",
 * not "mks"): vowel signs are dropped here as well, because the point of the
 * module is that `रामदेवी`, `ramdevi` and `राम देवी` collapse to one key, and
 * keeping the vowels on one side only would be exactly what prevents that.
 * `phoneticKey` then applies the matching collapses on the Latin side so both
 * scripts are compared in the same alphabet.
 */
export function devanagariToLatin(text: string): string {
  const escapeAlternation = (table: Record<string, string>): RegExp =>
    new RegExp(
      Object.keys(table)
        .sort((a, b) => b.length - a.length)
        .map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|'),
      'g'
    );

  const conjunctRe = escapeAlternation(CONJUNCT);
  // The nukta letters MUST be an alternation, not a `[...]` character class.
  // Each is two code points (base + U+093C), and a character class parses
  // those as two *independent* alternatives — so bare `क` would match the
  // class, look up `NUKTA_LETTERS['क']`, get `undefined`, and splice the
  // literal string "undefined" into the key. That is not hypothetical: it
  // turned `मुकेश कुमार` into `mundefinedsh undefinedmr` and quietly broke
  // every Hindi name starting with k/g/j/d/p/f/r.
  const nuktaRe = escapeAlternation(NUKTA_LETTERS);

  // Consonants genuinely are all single code points, so a class is correct
  // here — and the class form is what makes this pass fast over 6,855 rows.
  const consonantRe = new RegExp(
    `[${Object.keys(CONSONANT).sort((a, b) => b.length - a.length).join('')}]`,
    'g'
  );

  return text
    .replace(DIGITS, (digit) => String(digit.charCodeAt(0) - 0x0966))
    // `?? matched` on both table lookups: a table miss should pass the
    // character through untouched, never emit "undefined" into an index.
    .replace(nuktaRe, (matched) => NUKTA_LETTERS[matched] ?? matched)
    // Any nukta left over was a combining mark on an already-mapped letter.
    .replace(/़/g, '')
    .replace(conjunctRe, (matched) => CONJUNCT[matched] ?? matched)
    .replace(consonantRe, (matched) => CONSONANT[matched] ?? matched)
    .replace(INDEPENDENT_VOWELS, '')
    .replace(ANUSVARA, 'n')
    .replace(DROPPED_SIGNS, '')
    .replace(VOCALIC_R, 'r')
    // Whatever is left (conjunct leftovers, stray marks) is noise for a
    // phonetic key.
    .replace(/[^a-zA-Z0-9ऀ-ॿ]/g, ' ');
}

/**
 * One row's indexed forms, kept apart rather than concatenated.
 *
 * An earlier version joined them with `KEY_SEPARATOR` into a single string and
 * matched with `includes`. That is wrong, and the test suite caught it: the
 * token also went through `searchKeyOf`, so a query key was `"native\u0001phonetic"`
 * while the haystack had only **one** separator in the whole row — the two
 * could never both be found, so a plain phone number matched nothing. Comparing
 * the two forms field-by-field is both correct and cheaper: no split, no
 * separator, and a match in *either* script counts.
 */
export type SearchKey = {
  /** Devanagari with matras stripped; identical to the input for Latin text. */
  native: string;
  /** Consonant skeleton; comparable across scripts. */
  phonetic: string;
};

export function keyOf(text: string): SearchKey {
  return { native: nativeKey(text), phonetic: phoneticKey(text) };
}

/**
 * A token matches if **either** of its forms appears in the corresponding form
 * of the key. Symmetric on purpose: a Hindi query matches the native side, a
 * Latin query matches the phonetic side, and either keyboard can find either.
 */
export function keyContains(key: SearchKey, token: SearchKey): boolean {
  if (token.native.length > 0 && key.native.includes(token.native)) return true;
  if (token.phonetic.length > 0 && key.phonetic.includes(token.phonetic)) return true;
  return false;
}

/**
 * How good a match is, for ordering: 3 is an exact match, 2 a substring, 1
 * phonetic-only.
 *
 * The list sorts by this, so a row whose text the user typed *exactly* floats
 * above one that merely reduces to the same consonants. Without it, dropping
 * vowels makes every phonetic hit look equally good — which for a karykarta is
 * the difference between the right person and a plausible-looking stranger.
 */
export function rankKey(key: SearchKey, token: SearchKey): number {
  if (token.native.length === 0 && token.phonetic.length === 0) return 3;
  if (key.native === token.native || key.phonetic === token.phonetic) return 3;
  if (keyContains(key, token)) return 2;
  return 1;
}