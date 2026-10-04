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
 * Devanagari keyboard *and* from a Latin one. See that module for why there is
 * no stored English copy of the data — the short version is that
 * transliteration is not translation, and derived data in the database rots.
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
import { keyContains, keyOf, rankKey, type SearchKey } from '@/lib/roll/translit';
import type { VoterView } from '@/lib/roll/types';

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
 * Every searchable field of one voter.
 *
 * Kept as a list of separate values rather than a joined string, so each field
 * keeps its own boundaries once keyed — see the note at the top of the file.
 * Order is stable, which is what makes the built index comparable between runs.
 */
export function searchableFieldsOf(voter: VoterView): string[] {
  const e = voter.effective;
  return [
    e.name,
    voter.nameEn ?? '',
    voter.fatherOrHusbandName,
    e.fatherOrHusbandName,
    voter.fatherOrHusbandNameEn ?? '',
    e.locality,
    voter.locality,
    voter.localityEn ?? '',
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
    voter.overlay.leaning ?? '',
    voter.overlay.leaningNote ?? '',
    voter.overlay.note ?? '',
  ].filter(Boolean);
}

/**
 * The full searchable key of one voter: both scripts, one space-joined string
 * per script.
 */
export function haystackOf(voter: VoterView): SearchKey {
  const fields = searchableFieldsOf(voter);
  return {
    native: fields.map((field) => keyOf(field).native).join(' '),
    phonetic: fields.map((field) => keyOf(field).phonetic).join(' '),
  };
}

/** `voterId → key`, built once per loaded set. */
export type SearchIndex = ReadonlyMap<string, SearchKey>;

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
const baseKeyCache = new Map<string, SearchKey>();

/** Bounds the cache — same reasoning as `KEY_CACHE_MAX` in `translit.ts`. */
const BASE_KEY_CACHE_MAX = 30_000;
const BASE_KEY_CACHE_EVICT = 4_096;

function rememberBaseKey(voterId: string, key: SearchKey): SearchKey {
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
  const index = new Map<string, SearchKey>();
  for (const voter of voters) {
    // `updatedAt` is required on every overlay the app writes, so its absence
    // is exactly "nothing has ever been written for this voter".
    if (voter.overlay.updatedAt === undefined) {
      const cached = baseKeyCache.get(voter.id);
      if (cached !== undefined) {
        index.set(voter.id, cached);
        continue;
      }
      const key = haystackOf(voter);
      index.set(voter.id, key);
      rememberBaseKey(voter.id, key);
      continue;
    }
    index.set(voter.id, haystackOf(voter));
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
export function matches(index: SearchIndex, voter: VoterView, query: string): boolean {
  const tokens = queryTokens(query);
  if (!tokens.length) return true;

  const haystack = index.get(voter.id);
  if (haystack === undefined) return false;

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
 */
export function searchVoters(
  voters: VoterView[],
  index: SearchIndex,
  query: string
): VoterView[] {
  const trimmed = query.trim();
  if (!trimmed) return voters;

  const tokens = queryTokens(trimmed);

  const hits: { voter: VoterView; rank: number }[] = [];
  for (const voter of voters) {
    const haystack = index.get(voter.id);
    if (haystack === undefined) continue;
    if (!tokens.every((token) => keyContains(haystack, token))) continue;

    let rank = 3;
    for (const token of tokens) rank = Math.min(rank, rankKey(haystack, token));
    hits.push({ voter, rank });
  }

  hits.sort((a, b) => a.rank - b.rank);
  return hits.map((hit) => hit.voter);
}