/**
 * Devanagari → readable Latin (the "English copy" of the roll's Hindi fields).
 *
 * Not to be confused with `translit.ts`, which produces the *vowel-less
 * consonant skeleton* used for fuzzy matching. That module's job is to make
 * `रामदेवी`, `ramdevi` and `राम देवी` agree; this module's job is to produce the
 * string a human would actually type — `Ramdevi`, `Sharma`, `Hariram` — so a
 * Latin query can match it by plain substring, exact and stable.
 *
 * Both sides stay in the pipeline: search indexes the romanised copy *and*
 * the phonetic skeleton, so an approximation here costs nothing but a
 * lower-ranked match (the skeleton is the safety net).
 *
 * ## The three rules that make it read like Latin script
 *
 * 1. **Inherent vowel.** Every consonant carries an `a` unless a vowel sign
 *    or a virama says otherwise: `शर्मा` = श + र + ् + म + ा → `sha` + `r`
 *    (virama kills the `a`) + `ma` (the matra replaces it) = `sharma`.
 *    The inherent `a` is emitted as a placeholder so rule 3 can find it.
 * 2. **Anusvara by context.** `ं` is `n` by default, but before `ह` it is
 *    `ng` (`सिंह` → `singh`, not `sinh`) and before the labials म/b/p it is
 *    `m` (`मुंबई` → `mumbai`). This is where naive transliterations most
 *    visibly stop looking like names people recognise.
 * 3. **Word-final schwa deletion.** Hindi drops the final `a` when a word is
 *    spoken — `मुकेश` is "Mukesh", not "Mukesha". So a trailing inherent
 *    placeholder disappears at a word boundary. Vowel signs are *real*
 *    vowels and never drop: `शर्मा` keeps its final `a`.
 *
 * Deliberately a heuristic, not a linguistics paper: it is generated offline
 * into `assets/roll/*.json` by `scripts/generate-ward-bundles.ts`, regenerable
 * at any time, and every search still falls back to the phonetic skeleton.
 */

/** Devanagari consonant → Latin, WITH aspiration kept (`ख` → `kh`). */
const CONSONANT: Record<string, string> = {
  // velars
  क: 'k', ख: 'kh', ग: 'g', घ: 'gh', ङ: 'ng',
  // palatals
  च: 'c', छ: 'ch', ज: 'j', झ: 'jh', ञ: 'n',
  // retroflexes
  ट: 't', ठ: 'th', ड: 'd', ढ: 'dh', ण: 'n',
  // dentals
  त: 't', थ: 'th', द: 'd', ध: 'dh', न: 'n',
  // labials
  प: 'p', फ: 'ph', ब: 'b', भ: 'bh', म: 'm',
  // semivowels
  य: 'y', र: 'r', ल: 'l', व: 'v',
  // sibilants + h
  श: 'sh', ष: 'sh', स: 's', ह: 'h',
  // rare / Vedic
  ळ: 'l', ऴ: 'l', ऱ: 'r',
};

/** Nukta letters, folded to their own sounds before the nukta is stripped.
 *
 *  ड़/ढ़ read as `d`/`dh` in the spellings people actually use ("Bada",
 *  "Sardar"), not the flap `r` the phonetic skeleton prefers. */
const NUKTA: Record<string, string> = {
  'क़': 'q', 'ख़': 'kh', 'ग़': 'gh', 'ज़': 'z', 'ड़': 'd', 'ढ़': 'dh', 'फ़': 'f',
};

/**
 * Conjuncts folded to a single token *before* the consonant pass. Without
 * this, `ज्ञ` would decompose as `j` + `n` ("jn") where every Latin spelling
 * of it is `gy` (`ज्ञान` → "gyan"). The other conjuncts decompose to the same
 * result naturally — they are listed only so ordering stays explicit.
 */
const CONJUNCT: Record<string, string> = {
  'ज्ञ': 'gy',
};

/** Independent vowels (no preceding consonant). */
const VOWEL: Record<string, string> = {
  अ: 'a', आ: 'a', इ: 'i', ई: 'i', उ: 'u', ऊ: 'u',
  ऋ: 'r', ए: 'e', ऐ: 'e', ओ: 'o', औ: 'o',
  ऍ: 'e', ऑ: 'o', ऎ: 'e', ऒ: 'o', ऌ: 'l',
};

/** Vowel signs (matras). Same Latin shapes as the independent vowels.
 *
 *  Quoted keys, unlike the consonant tables: a matra *starts* with a
 *  combining mark (U+093E etc.), which cannot begin a JavaScript
 *  identifier — only follow one — so bare keys are a syntax error. */
const MATRA: Record<string, string> = {
  'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u',
  // Vocalic r reads as `ri` — कृष्ण is "Krishn", not "Krshn".
  'ृ': 'ri', 'ॄ': 'ri', 'े': 'e', 'ै': 'e',
  // Both o-matras: ो (U+094B, the common one) and ॊ (U+094A, the pre-o
  // form). Missing U+094B silently dropped every `ो` in the roll —
  // `तोष` romanised as `tोsh`.
  'ो': 'o', 'ॊ': 'o', 'ौ': 'o',
  'ॅ': 'e', 'ॉ': 'o', 'ॆ': 'e', '॒': '', '॑': '',
  'ॢ': 'l', 'ॣ': 'l',
};

/** Devanagari digits → ASCII. */
const DIGITS = /[०-९]/g;

/** Marks with no Latin counterpart (visarga, stray accents, danda…). */
const DROPPED_MARKS = /[ःऀँं़ऽ।॥॒॓॔ॕॖॗॢॣ्]/g;

/**
 * The inherent vowel rides along as a placeholder so it can be told apart
 * from a real `a` (from ा, अ, …) at word boundaries. A private-use code
 * point cannot collide with anything in the input.
 */
const INHERENT = '\uE001';


const escapeAlternation = (keys: string[]): RegExp =>
  new RegExp(
    keys
      .sort((a, b) => b.length - a.length)
      .map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|'),
    'g'
  );

const NUKTA_RE = escapeAlternation(Object.keys(NUKTA));
const CONJUNCT_RE = escapeAlternation(Object.keys(CONJUNCT));
const VOWEL_RE = escapeAlternation(Object.keys(VOWEL));
// The class is fine for matras — all single code points.
const MATRA_RE = new RegExp(`[${Object.keys(MATRA).join('')}]`, 'g');

/**
 * True when the text contains any Devanagari code point — the caller-side
 * gate: pure Latin input is returned untouched.
 */
export function hasDevanagari(text: string): boolean {
  return /[ऀ-ॿ]/.test(text);
}


/**
 * Devanagari → ASCII Latin with inherent vowels and word-final schwa
 * deletion. Latin-only input passes through unchanged.
 */
export function romanize(text: string): string {
  if (!text) return text;
  if (!hasDevanagari(text)) return text;

  let s = text;

  // 1. Digits first, so later passes see ASCII.
  s = s.replace(DIGITS, (digit) => String(digit.charCodeAt(0) - 0x0966));

  // 2. Conjunct folding (ज्ञ → gy) before any consonant pass can split it.
  s = s.replace(CONJUNCT_RE, (matched) => CONJUNCT[matched] ?? matched);

  // 3. Anusvara / candrabindu by the sound that follows. Lookaheads, not
  //    consuming matches: the following letter must survive to its own pass —
  //    `/ंह/` written as a plain match swallowed the ह and turned सिंह into
  //    "Sing", and `/ंब/` ate the ब of अंबेडकर.
  s = s.replace(/ं(?=ह)/g, 'ng');
  s = s.replace(/ं(?=[मबप])/g, 'm');
  s = s.replace(/[ंँ]/g, 'n');

  // 4. Virama kills the preceding consonant's inherent vowel:
  //    consonant + ् → bare Latin consonant. Runs before the main pass so
  //    the consonant-with-vowel rule below never sees these.
  s = s.replace(
    new RegExp(`(${escapeSource(Object.keys(NUKTA))}|${escapeSource(Object.keys(CONJUNCT))}|[क-हळऱ])्`, 'g'),
    (matched, cons: string) => baseOf(cons)
  );

  // 5. Every remaining consonant: explicit matra replaces the vowel, else the
  //    inherent placeholder is emitted. The matra group must CAPTURE — with
  //    `(?:…)` the replace callback's next argument is the match offset, not
  //    the matra, and every vowel silently became ''.
  s = s.replace(
    new RegExp(
      `(${escapeSource(Object.keys(NUKTA))}|[क-हळऱ])(${escapeSource(Object.keys(MATRA))})?`,
      'g'
    ),
    (matched, cons: string, matra?: string) =>
      baseOf(cons) + (matra !== undefined ? (MATRA[matra] ?? '') : INHERENT)
  );
  // 5b. A matra with no consonant in front of it — after a folded cluster
  //     (`ज्ञा` → `gy` + ा) or an independent vowel — still has to become its
  //     Latin vowel, or the Devanagari sign leaks into the English copy.
  s = s.replace(MATRA_RE, (matched) => MATRA[matched] ?? '');

  // 6. Independent vowels (अ, ई, …) → their Latin vowels.
  s = s.replace(VOWEL_RE, (matched) => VOWEL[matched] ?? matched);

  // 7. Anything left over — visarga, lone nukta marks, danda — is noise.
  s = s.replace(DROPPED_MARKS, '');

  // 7b. Safety net: any Devanagari still in the string is a table miss (an
  //     exotic mark a future Unicode rev might add). Dropping it keeps the
  //     English copy Latin — a lost letter beats Devanagari leaking into a
  //     field a karykarta types a Latin query against.
  s = s.replace(/[\u0900-\u097F]/g, '');

  // 8. Resolve inherent placeholders: dropped at a word boundary (Hindi's
  //    final schwa deletion — `मुकेश` is "Mukesh"), kept mid-word.
  s = s.replace(new RegExp(`${INHERENT}(?![A-Za-z${INHERENT}])`, 'g'), '');
  s = s.split(INHERENT).join('a');

  // 9. Tidy: collapse whitespace runs the folds may have opened up.
  return s.replace(/\s+/g, ' ').trim();
}

/** Longest-first alternation source for a table's keys. */
function escapeSource(keys: string[]): string {
  return keys
    .sort((a, b) => b.length - a.length)
    .map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
}

/** Latin base for a consonant unit (handles nukta two-code-point letters). */
function baseOf(cons: string): string {
  return NUKTA[cons] ?? CONSONANT[cons] ?? CONJUNCT[cons] ?? '';
}

/**
 * Presentation casing for the English copy: `अर्जुन शर्मा` → `Arjun Sharma`,
 * including after commas, which localities use as separators
 * (`बाबा रामदेव नगर,सांगरिया` → `Baba Ramdev Nagar,Sangariya`).
 */
export function titleCase(latin: string): string {
  return latin.replace(
    /(^|[^\p{L}])(\p{L})/gu,
    (_match, boundary: string, letter: string) => boundary + letter.toUpperCase()
  );
}
