/**
 * Search over the roll (plan-voters.md §4).
 *
 * The requirement is "search by every field", so rather than a column list
 * that silently rots when the model grows, each voter gets one haystack built
 * from *all* its searchable text — roll fields plus the overlay's phone,
 * leaning and note. Keys are built once at index time, so a query is a cheap
 * scan over pre-built strings: 6855 rows is nothing.
 *
 * Matching is token-AND: "राम देवी" matches voters whose haystack contains
 * both tokens in any order, which is what people actually type.
 *
 * ## Scripts
 *
 * Keys are built through `lib/roll/translit.ts`, so a row is findable from a
 * Devanagari keyboard *and* from a Latin one. On top of that, the bundled
 * roll carries a generated English copy of the Hindi fields (`nameEn` and
 * friends, from `lib/roll/romanize.ts`) which is indexed as ordinary text:
 * `ramesh` then matches `Ramesh Kumar` by plain substring — exact and
 * stable — while the phonetic skeleton stays the fuzzy fallback that makes
 * `रामेश` and `ramesh` meet in the middle. The copy is regenerated from the
 * CSVs by `scripts/generate-ward-bundles.ts`, beside its source, so it
 * cannot drift.
 *
 * ## Why each field is keyed separately
 *
 * The obvious implementation joins every field into one string and keys the
 * result. It is wrong twice over: concatenating `राम देवी` and `नगर` produces a
 * blob in which the *boundary* between fields is gone, so a query can match by
 * straddling two unrelated fields. Keying field-by-field and joining the keys
 * keeps each field's key intact while still allowing one `includes` over the
 * lot. It also means the keys stay short, which is what makes the scan cheap.
 *
 * ## Ranking
 *
 * Because a phonetic key deliberately discards vowels, a match can be loose:
 * `kmr` matches `कुमार` but also anything else running k-m-r. Left unordered,
 * the wrong Mukesh can sit above the right one, which for a karykarta standing
 * in front of a voter is worse than no result at all. So results carry a rank
 * from `rankKey` — exact, then substring, then phonetic-only — and
 * `searchVoters` sorts by it, stable, so equal ranks keep roll order (ward,
 * then serial) and the list does not reshuffle between keystrokes.
 */
import {
  HAYSTACK_SEP,
  keyContains,
  keyOf,
  rankKey,
  type SearchKey,
} from '@/lib/roll/translit';
import type { VoterView } from '@/lib/roll/types';

/**
 * Which group of fields a query is matched against.
 *
 * The list screen defaults to `name` — the thing people actually say out
 * loud — and the badge row lets the karykarta widen the search to a father's
 * name, the locality, or everything else (EPIC, house, phone, age, note).
 * The index keeps one key per group so widening is a union of pre-built keys,
 * not a re-key of every field per keystroke.
 */
export type SearchScope = 'name' | 'father' | 'locality' | 'other';

/** Fixed order — this is what makes `all` a stable join of the four. */
export const SEARCH_SCOPES = ['name', 'father', 'locality', 'other'] as const;

/** One voter's index entry: a key per scope, plus the union of all four. */
export type IndexEntry = {
  readonly all: SearchKey;
} & Readonly<Record<SearchScope, SearchKey>>;

/**
 * Lowercase, strip ASCII punctuation, collapse whitespace.
 *
 * Deliberately ASCII-only. An earlier version of this function also stripped
 * Devanagari matras, which silently deleted the vowel signs *before*
 * `translit.ts` could see them — so a query typed with full matras was
 * compared against a haystack built with them, and every native match lost its
 * exact-match rank. Script-specific normalisation is `translit.ts`'s job.
 */
export function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,\/#!$%^&*;:{}=-_`~()"'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Every searchable field of one voter, grouped by scope.
 *
 * Kept as lists of separate values rather than a joined string, so each field
 * keeps its own boundaries once keyed — see the note at the top of the file.
 * The groups partition the old flat list exactly: concatenated in
 * `SEARCH_SCOPES` order they produce the same fields in the same order, so
 * the `all` key stays byte-identical to what the flat version built.
 */
export function scopeFieldsOf(voter: VoterView): Record<SearchScope, string[]> {
  const e = voter.effective;
  return {
    name: [e.name, voter.nameEn ?? ''],
    father: [
      voter.fatherOrHusbandName,
      e.fatherOrHusbandName,
      voter.fatherOrHusbandNameEn ?? '',
    ],
    locality: [e.locality, voter.locality, voter.localityEn ?? ''],
    other: [
      e.houseNo,
      voter.houseNo,
      voter.epicId,
      voter.gender,
      e.gender,
      String(voter.age),
      String(voter.serialNo),
      String(voter.wardNo),
      String(voter.pdfPage),
      voter.relationLabel,
      e.phone,
      e.jati,
      voter.overlay.support ?? '',
      voter.overlay.leaning ?? '',
      voter.overlay.leaningNote ?? '',
      voter.overlay.note ?? '',
    ],
  };
}

/** Every searchable field of one voter, in the legacy flat order. */
export function searchableFieldsOf(voter: VoterView): string[] {
  const groups = scopeFieldsOf(voter);
  return SEARCH_SCOPES.flatMap((scope) => groups[scope]);
}

/** Keys one field list the way the flat haystack used to be built. */
function joinFields(fields: string[]): SearchKey {
  const kept = fields.filter(Boolean);
  return {
    native: kept.map((field) => keyOf(field).native).join(HAYSTACK_SEP),
    phonetic: kept.map((field) => keyOf(field).phonetic).join(HAYSTACK_SEP),
  };
}

/**
 * The full searchable key of one voter: both scripts, one separator-joined
 * string per script. Fields are joined with `HAYSTACK_SEP` (not a space) so
 * `rankKey` can tell a whole-field exact hit from a substring of a longer
 * field — see the note there.
 */
export function haystackOf(voter: VoterView): SearchKey {
  return entryFor(voter).all;
}

/** Builds one voter's per-scope index entry (and the `all` union). */
function entryFor(voter: VoterView): IndexEntry {
  const groups = scopeFieldsOf(voter);
  const scoped = {} as Record<SearchScope, SearchKey>;
  for (const scope of SEARCH_SCOPES) scoped[scope] = joinFields(groups[scope]);
  return {
    ...scoped,
    all: {
      native: SEARCH_SCOPES.map((scope) => scoped[scope].native).join(HAYSTACK_SEP),
      phonetic: SEARCH_SCOPES.map((scope) => scoped[scope].phonetic).join(HAYSTACK_SEP),
    },
  };
}

/**
 * The key a query should be matched against.
 *
 * No scopes (or all of them) → the pre-joined `all` key, so the default
 * path costs one map lookup. One scope → its key directly. Two or three →
 * a join of pre-built keys, which is string concatenation over already-keyed
 * text: no transliteration, no per-field work.
 */
function resolveKey(entry: IndexEntry, scopes?: readonly SearchScope[]): SearchKey {
  if (!scopes || scopes.length === 0 || scopes.length >= SEARCH_SCOPES.length) {
    return entry.all;
  }
  if (scopes.length === 1) return entry[scopes[0]];
  return {
    native: scopes.map((scope) => entry[scope].native).join(HAYSTACK_SEP),
    phonetic: scopes.map((scope) => entry[scope].phonetic).join(HAYSTACK_SEP),
  };
}

/** `voterId → IndexEntry`, built once per loaded set. */
export type SearchIndex = ReadonlyMap<string, IndexEntry>;

/**
 * `voterId → key` for rows whose key is a pure function of the base row.
 *
 * The base roll never changes for a given id, so its key never changes either
 * — which makes re-indexing the same row pure waste. That waste was not
 * theoretical: `useRoll` rebuilds the index whenever the row set changes (a
 * new ward batch, an overlay write, a refetch), and a full build over 6,855
 * rows used to cost *seconds* of blocked JS thread on every one of those.
 *
 * The guard is `overlay.updatedAt === undefined`, i.e. "this voter has never
 * been edited": an edited row's `effective` fields (and phone / leaning / note)
 * are overlay-derived, so it must be keyed fresh every time. An unedited row's
 * key is derived only from base fields, which are immutable per id.
 *
 * Session-scoped deliberately: the cache dies with the process, so a reseed
 * that changes a row under the same id cannot outlive the session that knew
 * the old value.
 */
const baseKeyCache = new Map<string, IndexEntry>();

/** Bounds the cache — same reasoning as `KEY_CACHE_MAX` in `translit.ts`. */
const BASE_KEY_CACHE_MAX = 30_000;
const BASE_KEY_CACHE_EVICT = 4_096;

function rememberBaseKey(voterId: string, key: IndexEntry): IndexEntry {
  if (baseKeyCache.size >= BASE_KEY_CACHE_MAX) {
    let toEvict = BASE_KEY_CACHE_EVICT;
    for (const existing of baseKeyCache.keys()) {
      baseKeyCache.delete(existing);
      if (--toEvict <= 0) break;
    }
  }
  baseKeyCache.set(voterId, key);
  return key;
}

export function buildIndex(voters: VoterView[]): SearchIndex {
  const index = new Map<string, IndexEntry>();
  for (const voter of voters) {
    // `updatedAt` is required on every overlay the app writes, so its absence
    // is exactly "nothing has ever been written for this voter".
    if (voter.overlay.updatedAt === undefined) {
      const cached = baseKeyCache.get(voter.id);
      if (cached !== undefined) {
        index.set(voter.id, cached);
        continue;
      }
      const key = entryFor(voter);
      index.set(voter.id, key);
      rememberBaseKey(voter.id, key);
      continue;
    }
    index.set(voter.id, entryFor(voter));
  }
  return index;
}

/**
 * Splits a query into keyed tokens.
 *
 * Each token keeps *both* forms, so it can be checked against the matching half
 * of a key instead of being forced into one alphabet. Split on whitespace first,
 * because `राम देवी` is two tokens and not one.
 */
function queryTokens(query: string): SearchKey[] {
  return query
    .split(/\s+/)
    .map((token) => normalizeToken(token))
    .filter(Boolean)
    .map((token) => keyOf(token));
}

/**
 * Every token must appear in the voter's haystack. An empty query matches
 * everything, and a query that is only separators matches everything too — the
 * caller should not have to care that "  " normalises to nothing.
 */
export function matches(
  index: SearchIndex,
  voter: VoterView,
  query: string,
  scopes?: readonly SearchScope[]
): boolean {
  const tokens = queryTokens(query);
  if (!tokens.length) return true;

  const entry = index.get(voter.id);
  if (entry === undefined) return false;

  const haystack = resolveKey(entry, scopes);
  return tokens.every((token) => keyContains(haystack, token));
}

/**
 * Convenience: filter a list by `query` using a prebuilt index, best match
 * first.
 *
 * Tokens and ranks are computed **once per query**, outside the loop. Deriving
 * them inside the comparator — which is what this did first — re-tokenises the
 * query O(n log n) times: about 90,000 redundant passes on a full-ward search,
 * and that is precisely the kind of thing a user feels as lag between
 * keystrokes. `Array.prototype.sort` is stable, so equal ranks stay in roll
 * order and the list does not shuffle as more characters arrive.
 *
 * `scopes` narrows *which* fields are matched — see `SearchScope`. Omitted,
 * every field is searched, which is the behaviour every existing caller and
 * test gets unchanged.
 */
export function searchVoters(
  voters: VoterView[],
  index: SearchIndex,
  query: string,
  scopes?: readonly SearchScope[]
): VoterView[] {
  const trimmed = query.trim();
  if (!trimmed) return voters;

  const tokens = queryTokens(trimmed);

  const hits: { voter: VoterView; rank: number }[] = [];
  for (const voter of voters) {
    const entry = index.get(voter.id);
    if (entry === undefined) continue;
    const haystack = resolveKey(entry, scopes);
    if (!tokens.every((token) => keyContains(haystack, token))) continue;

    let rank = 3;
    for (const token of tokens) rank = Math.min(rank, rankKey(haystack, token));
    hits.push({ voter, rank });
  }

  // Descending: rank 3 (exact field) is *best*, so it must lead. Ascending
  // here put every exact match below every loose one — invisible while
  // whole-haystack equality never fired and everything tied at 2, but a
  // real inversion the moment `rankKey` started recognising field-level
  // exacts. Stable either way, so equal ranks keep roll order.
  hits.sort((a, b) => b.rank - a.rank);
  return hits.map((hit) => hit.voter);
}