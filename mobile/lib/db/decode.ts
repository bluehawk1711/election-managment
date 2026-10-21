/**
 * Turning an RTDB node's value into fields — with no SDK in sight, so it can
 * be tested directly instead of through a live database.
 *
 * **Why a whole module for this.** RTDB's encoder renders a node whose keys
 * are integers as a JSON array, and that is not hypothetical: `/wards` is
 * keyed `"1".."13"` because those ids come from Firestore and every lookup
 * (`wardById`, `area.wardId`) depends on them being exactly those strings.
 * So `/wards` arrives from the client SDK as `[null, ward1, …, ward13]`.
 *
 * Every symptom of that is silent:
 *
 *  - a `!isRecord(value)` guard reads the node as "empty", so the ward picker
 *    renders with nothing in it and no error is thrown anywhere;
 *  - `data()` returning `{}` makes `wardFromDoc` build a Ward of zeros, which
 *    sorts and renders as a row rather than failing;
 *  - all 240 unit tests stay green, because the fixture is a hand-written
 *    object and the array only appears once real data is written.
 *
 * Which is why `scripts/verify-client.mjs` exists: it reads production through
 * the real `firebase/database` package and reports the shape it got. This is
 * the part it reported.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A node's children as `[key, value]` pairs, whatever shape it arrived in.
 *
 * For an array, **the index is the key** — that is how the encoder built it —
 * so reading the index back off a hole-free pass restores exactly the keys
 * that went in, including `"3"` in a node holding `"1"` and `"3"` with nothing
 * between. The `null` entries are padding for an index nobody wrote; they
 * cannot be stored data, because RTDB drops `null` children on write (which is
 * what `setDoc` documents them as).
 *
 * A node that is absent (`null`), or a primitive standing where the app
 * expects an object, yields no children — the same "empty" reading the code
 * had before, and for a `null` the only correct one.
 */
export function childrenOf(raw: unknown): Array<[string, unknown]> {
  if (Array.isArray(raw)) {
    return raw.flatMap((value, index) => (value === null ? [] : [[String(index), value]]));
  }
  return isRecord(raw) ? Object.entries(raw) : [];
}

/**
 * A node as fields, for `DbSnapshot.data()`.
 *
 * Only arrays pay the conversion cost: `data()` runs inside sort comparators
 * (`byField` calls it twice per comparison), so copying a plain object here
 * would turn an O(n log n) sort into an O(n²) one. Returning the same object
 * each call also keeps `toEqual`-style assertions honest about identity.
 */
export function dataOf(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (Array.isArray(value)) return Object.fromEntries(childrenOf(value));
  return {};
}
