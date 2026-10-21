import { childrenOf, dataOf } from '@/lib/db/decode';

/**
 * The array shape is not a hypothetical encoding — it is what production
 * actually returns for `/wards`.
 *
 * Ward ids are `"1".."13"` because they came from Firestore and every lookup
 * depends on those exact strings (`wardById.get(area.wardId)`,
 * `wardFromDoc`'s id). An integer-keyed node is rendered by RTDB as a JSON
 * array, so `GET /wards` gives `[null, ward1, …, ward13]`.
 *
 * Before this was handled, `selectRows` had an `!isRecord(raw) return []`
 * guard, so listing wards returned zero rows with no error while
 * `GET /wards/5` returned a perfectly good ward. The screen would have shown
 * an empty ward picker and all 240 tests would have stayed green, because the
 * fixtures are hand-written objects and the array only appears once real data
 * exists. `scripts/verify-client.mjs` is what found it; these tests are what
 * keep it found.
 *
 * The one assertion that must never be weakened: **the id is the index**, so
 * `1..13` come back as `1..13` and not `0..13`.
 */
describe('childrenOf', () => {
  it('restores integer keys from the array form, dropping the hole at 0', () => {
    // Exactly what `GET /wards` returned against production: 13 wards, so the
    // encoder padded index 0, which nobody ever wrote.
    const wards = [null, { wardNo: 1, name: 'वार्ड 1' }, { wardNo: 2, name: 'वार्ड 2' }];

    expect(childrenOf(wards)).toEqual([
      ['1', { wardNo: 1, name: 'वार्ड 1' }],
      ['2', { wardNo: 2, name: 'वार्ड 2' }],
    ]);
  });

  it('keeps the id as the index, not the position in the array', () => {
    // The regression this exists for: shifting would map ward 1 to id "0" and
    // ward 13 to id "12", which is worse than an empty list because it is
    // wrong data rather than obviously-wrong data.
    const thirteen = [null, ...Array.from({ length: 13 }, (_, i) => ({ wardNo: i + 1 }))];

    expect(childrenOf(thirteen).map(([key]) => key)).toEqual([
      '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13',
    ]);
  });

  it('keeps gaps as gaps rather than compacting them away', () => {
    // Keys "1" and "3" with no "2": the encoder pads index 2 with null, and
    // compacting would hand id "2" to the document that was really "3".
    const sparse = [null, { id: 'one' }, null, { id: 'three' }];

    expect(childrenOf(sparse)).toEqual([
      ['1', { id: 'one' }],
      ['3', { id: 'three' }],
    ]);
  });

  it('reads a plain object as itself, in the object\'s own key order', () => {
    // The common case — every collection with push-id or uid keys — must come
    // through untouched, because `selectRows` runs it on every list read.
    const tasks = { 'abc': { title: 'a' }, 'def': { title: 'b' } };

    expect(childrenOf(tasks)).toEqual([
      ['abc', { title: 'a' }],
      ['def', { title: 'b' }],
    ]);
  });

  it('treats an absent node as having no children', () => {
    expect(childrenOf(null)).toEqual([]);
    expect(childrenOf(undefined)).toEqual([]);
  });

  it('treats a primitive standing at a node as having no children', () => {
    // `snapshotOf` deliberately still reports such a node as existing — it is
    // malformed data, not absent data — but it has no listable rows either way.
    expect(childrenOf('paused')).toEqual([]);
    expect(childrenOf(42)).toEqual([]);
  });
});

describe('dataOf', () => {
  it('returns a plain object by reference, not a copy', () => {
    // `data()` is called twice per comparison inside `byField`, so copying here
    // would make every list read O(n²) in the length of the document.
    const doc = { name: 'वार्ड 1', voterCount: 778 };

    expect(dataOf(doc)).toBe(doc);
  });

  it('decodes the array form into fields, so data() is never blank', () => {
    // The other half of the silent failure: `data()` returning `{}` makes
    // `wardFromDoc` build a Ward of zeros, which sorts and renders as a row
    // instead of failing — so the picker shows 13 empty wards.
    const wards = [null, { wardNo: 1, name: 'वार्ड 1' }];

    expect(dataOf(wards)).toEqual({ '1': { wardNo: 1, name: 'वार्ड 1' } });
  });

  it('returns {} for an absent node, so mappers never see null', () => {
    expect(dataOf(null)).toEqual({});
    expect(dataOf(undefined)).toEqual({});
  });

  it('returns {} for a primitive, leaving the malformed node visible via exists()', () => {
    expect(dataOf('paused')).toEqual({});
  });
});
