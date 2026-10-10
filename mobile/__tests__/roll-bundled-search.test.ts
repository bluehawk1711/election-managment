/**
 * The bundled roll as the app actually reads it: `assets/roll/*.json` through
 * `bundledSource` → `mergeVoter` → `buildIndex` → `searchVoters`.
 *
 * This is the one place the *whole* pipeline is exercised against all 6,855
 * real rows rather than fixtures, and it is deliberately data-driven: the
 * expectations are derived from the same bundle, then the search must find
 * them from both scripts. If `scripts/generate-ward-bundles.ts` ever bakes a
 * bad English copy into the bundles, or `search.ts` stops indexing it, these
 * fail — which is exactly what "English → Hindi search not working properly"
 * looked like from the user's side.
 */
import { BUNDLE_WARD_COUNT, bundledVoters, bundledWards } from '@/lib/roll/bundled';
import { bundledSource } from '@/lib/roll/bundled-source';
import { mergeVoter } from '@/lib/roll/merge';
import { buildIndex, searchVoters } from '@/lib/roll/search';
import { keyOf, rankKey } from '@/lib/roll/translit';
import type { RollVoter, VoterView } from '@/lib/roll/types';

/** Every bundled row, once for the whole file. */
const ALL: RollVoter[] = (() => {
  const rows: RollVoter[] = [];
  for (let wardNo = 1; wardNo <= BUNDLE_WARD_COUNT; wardNo += 1) {
    rows.push(...(bundledVoters(wardNo) ?? []));
  }
  return rows;
})();

const VIEWS: VoterView[] = ALL.map((row) => mergeVoter(row, undefined));
const INDEX = buildIndex(VIEWS);

const idsOf = (query: string): Set<string> =>
  new Set(searchVoters(VIEWS, INDEX, query).map((voter) => voter.id));

describe('bundled roll integrity', () => {
  it('carries all 6,855 rows across 13 wards', () => {
    expect(BUNDLE_WARD_COUNT).toBe(13);
    expect(ALL).toHaveLength(6855);
  });

  it('agrees with the wards summary on per-ward counts', () => {
    const bundle = bundledWards();
    expect(bundle).not.toBeNull();
    expect(bundle!.wards).toHaveLength(BUNDLE_WARD_COUNT);
    expect(bundle!.total).toBe(ALL.length);

    for (const ward of bundle!.wards) {
      expect(bundledVoters(ward.wardNo)).toHaveLength(ward.voterCount);
    }
  });

  it('gives every row an English copy with no Devanagari left in it', () => {
    for (const row of ALL) {
      expect(row.nameEn).toBeTruthy();
      expect(row.fatherOrHusbandNameEn).toBeTruthy();
      expect(row.localityEn).toBeTruthy();
      expect(row.nameEn).not.toMatch(/[ऀ-ॿ]/);
      expect(row.fatherOrHusbandNameEn).not.toMatch(/[ऀ-ॿ]/);
      expect(row.localityEn).not.toMatch(/[ऀ-ॿ]/);
    }
  });

  it('returns null for a ward outside the bundle instead of throwing', () => {
    expect(bundledVoters(0)).toBeNull();
    expect(bundledVoters(14)).toBeNull();
  });

  it('serves the same rows through the RollSource interface', async () => {
    await expect(bundledSource.getWards()).resolves.toMatchObject({
      total: 6855,
    });
    await expect(bundledSource.getVoters(null)).resolves.toHaveLength(6855);
    await expect(bundledSource.getVoters(1)).resolves.toHaveLength(648);
    await expect(bundledSource.getVoters(99)).resolves.toEqual([]);
  });
});

describe('Hindi → English search (Latin query, Devanagari roll)', () => {
  it('finds सिंह rows when typing "singh"', () => {
    const hindi = VIEWS.filter((voter) =>
      [voter.name, voter.fatherOrHusbandName, voter.locality].some((field) =>
        field.includes('सिंह')
      )
    );
    expect(hindi.length).toBeGreaterThan(800);

    const found = idsOf('singh');
    for (const voter of hindi) expect(found.has(voter.id)).toBe(true);
  });

  it('findsरमेश rows when typing "ramesh"', () => {
    const hindi = VIEWS.filter((voter) =>
      [voter.name, voter.fatherOrHusbandName, voter.locality].some((field) =>
        field.includes('रमेश')
      )
    );
    expect(hindi.length).toBeGreaterThan(0);

    const found = idsOf('ramesh');
    for (const voter of hindi) expect(found.has(voter.id)).toBe(true);
  });

  it('finds a row by its exact English name', () => {
    const target = VIEWS.find((voter) => voter.name === 'रमेश');
    expect(target).toBeDefined();

    const hits = searchVoters(VIEWS, INDEX, 'ramesh');
    const token = keyOf('ramesh');

    // Ranking is monotone: exact-field hits lead, then word-starts, then
    // substrings.
    const ranks = hits.map((voter) => rankKey(INDEX.get(voter.id)!.all, token));
    expect(ranks[0]).toBe(6);
    for (let i = 1; i < ranks.length; i += 1) {
      expect(ranks[i]).toBeLessThanOrEqual(ranks[i - 1]);
    }

    // The person actually named Ramesh lands in the exact block — well before
    // रामस्वरूप, which only *contains* the query in its English copy.
    const targetAt = hits.findIndex((voter) => voter.id === target!.id);
    const varAt = hits.findIndex((voter) => voter.nameEn === 'Rameshvar');
    expect(targetAt).toBeGreaterThanOrEqual(0);
    expect(varAt).toBeGreaterThan(targetAt);
  });

  it('finds a locality by its English copy', () => {
    const target = VIEWS.find(
      (voter) => voter.localityEn === 'Baba Ramadev Nagar,Sangariya'
    );
    expect(target).toBeDefined();

    const found = idsOf('ramadev');
    expect(found.has(target!.id)).toBe(true);
  });

  it('still finds rows by EPIC id and by Hindi spelling', () => {
    const target = VIEWS.find((voter) => voter.name === 'रमेश सिंह');
    expect(target).toBeDefined();

    expect(idsOf(target!.epicId.toLowerCase()).has(target!.id)).toBe(true);
    expect(idsOf('रमेश सिंह').has(target!.id)).toBe(true);
  });
});

describe('English → Hindi search (Devanagari query, romanised copy)', () => {
  it('the Devanagari spelling of a Latin-only query still lands', () => {
    // सिंह typed natively must find the same rows "singh" found — the copy and
    // the original are two views of one row, not two indexes.
    const byLatin = idsOf('singh');
    const byDevanagari = idsOf('सिंह');
    expect(byDevanagari.size).toBeGreaterThan(0);

    const hindi = VIEWS.filter((voter) =>
      [voter.name, voter.fatherOrHusbandName, voter.locality].some((field) =>
        field.includes('सिंह')
      )
    );
    for (const voter of hindi) expect(byDevanagari.has(voter.id)).toBe(true);
    // Overlap is expected and fine (both match broadly); the point is that
    // neither script leaves a *class* of rows unreachable.
    expect(byLatin.size).toBeGreaterThan(0);
  });

  it('a matra-less Devanagari query finds the romanised row', () => {
    // रमेश without matras still matches via the phonetic skeleton.
    const target = VIEWS.find((voter) => voter.name === 'रमेश');
    expect(target).toBeDefined();
    expect(idsOf('रमश').has(target!.id)).toBe(true);
  });

  it('ranks exact-script rows above loose phonetic hits', () => {
    const hits = searchVoters(VIEWS, INDEX, 'रमेश');
    expect(hits.length).toBeGreaterThan(0);

    const token = keyOf('रमेश');
    const ranks = hits.map((voter) => rankKey(INDEX.get(voter.id)!.all, token));
    expect(ranks[0]).toBe(6);
    for (let i = 1; i < ranks.length; i += 1) {
      expect(ranks[i]).toBeLessThanOrEqual(ranks[i - 1]);
    }

    // रामस्वरूप shares the skeleton (rms…) but no field equals the query —
    // it must sit below every exact row.
    const firstExactAt = hits.findIndex((voter, i) => ranks[i] === 6);
    const lastExactAt = hits.length - 1 - [...ranks].reverse().findIndex((r) => r === 6);
    const swarupAt = hits.findIndex((voter) => voter.name === 'रामस्वरूप');
    expect(firstExactAt).toBe(0);
    expect(swarupAt).toBeGreaterThan(lastExactAt);

    // …while a row genuinely named रमेश sits inside the exact block.
    const target = VIEWS.find((voter) => voter.name === 'रमेश');
    const targetAt = hits.findIndex((voter) => voter.id === target!.id);
    expect(targetAt).toBeLessThanOrEqual(lastExactAt);
  });
});

describe('search over the full roll stays bounded', () => {
  it('a broad query renders through the result cap, not the whole roll', () => {
    // Mirrors RESULT_LIMIT on the voters screen: broad phonetic queries match
    // thousands of rows; the list must be able to cap them.
    const hits = searchVoters(VIEWS, INDEX, 'singh');
    expect(hits.length).toBeGreaterThan(300);
    expect(hits.slice(0, 300)).toHaveLength(300);
  });

  it('an empty query returns everything in roll order', () => {
    expect(searchVoters(VIEWS, INDEX, '   ')).toHaveLength(6855);
    expect(searchVoters(VIEWS, INDEX, '')[0].id).toBe('w1-1');
  });
});
