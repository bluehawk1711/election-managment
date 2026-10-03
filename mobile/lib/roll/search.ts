/**
 * Search over the roll (plan-voters.md §4).
 *
 * The requirement is "search by every field", so rather than a column list
 * that silently rots when the model grows, each voter gets one haystack built
 * from *all* its searchable text — roll fields plus the overlay's phone,
 * leaning and note. Tokens are normalised once at index time, so a query is a
 * cheap scan over pre-built strings: 6855 rows is nothing.
 *
 * Matching is token-AND: "राम देवी" matches voters whose haystack contains
 * both tokens in any order, which is what people actually type.
 */
import type { VoterView } from '@/lib/roll/types';

/** Lowercase, strip punctuation/marks, collapse whitespace. */
export function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()"'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The full searchable text of one voter — every field, in a stable order. */
export function haystackOf(voter: VoterView): string {
  const e = voter.effective;
  return normalizeToken(
    [
      e.name,
      voter.fatherOrHusbandName,
      e.fatherOrHusbandName,
      e.locality,
      voter.locality,
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
    ].join(' ')
  );
}

/** `voterId → haystack`, built once per loaded set. */
export type SearchIndex = ReadonlyMap<string, string>;

export function buildIndex(voters: VoterView[]): SearchIndex {
  const index = new Map<string, string>();
  for (const voter of voters) index.set(voter.id, haystackOf(voter));
  return index;
}

/**
 * Every token must appear in the voter's haystack. An empty query matches
 * everything, and a query that is only separators matches everything too —
 * the caller should not have to care that "  " normalises to nothing.
 */
export function matches(index: SearchIndex, voter: VoterView, query: string): boolean {
  const tokens = normalizeToken(query).split(' ').filter(Boolean);
  if (!tokens.length) return true;

  const haystack = index.get(voter.id);
  if (haystack === undefined) return false;

  return tokens.every((token) => haystack.includes(token));
}

/** Convenience: filter a list by `query` using a prebuilt index. */
export function searchVoters(
  voters: VoterView[],
  index: SearchIndex,
  query: string
): VoterView[] {
  const trimmed = query.trim();
  if (!trimmed) return voters;
  return voters.filter((voter) => matches(index, voter, trimmed));
}
