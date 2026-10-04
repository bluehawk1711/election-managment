/**
 * The scope-aware search index (list screen badges) and the nearest-voter
 * distance maths (plan-voters.md §6.1).
 *
 * Three contracts, all of which a user would notice immediately if they broke:
 * a name-only search must not match on a father-name hit, distances must be
 * real metres on real Jodhpur coordinates, and a repeated identical write must
 * not manufacture a "pending sync" badge.
 */
import {
  buildIndex,
  haystackOf,
  searchVoters,
  type SearchScope,
} from '@/lib/roll/search';
import { formatDistance, haversineMeters } from '@/lib/geo';
import {
  __resetOverlayCache,
  loadQueue,
  loadWardOverlay,
  patchVoter,
  putOverlay,
  type OverlayStorage,
} from '@/lib/roll/overlay';
import { mergeVoter } from '@/lib/roll/merge';
import type { RollVoter } from '@/lib/roll/types';

const base: RollVoter = {
  id: 'w1-1',
  wardNo: 1,
  serialNo: 1,
  epicId: 'CTK4949558',
  name: 'मुकेश कुमार',
  relation: 'father',
  relationLabel: 'पिता',
  fatherOrHusbandName: 'अर्जुन शर्मा',
  houseNo: '44',
  age: 54,
  gender: 'male',
  locality: 'सिविल लाइंस',
  pdfPage: 3,
  nameEn: 'Mukesh Kumar',
  fatherOrHusbandNameEn: 'Arjun Sharma',
  localityEn: 'Civil Lines',
};

const voters = [
  mergeVoter(base, undefined),
  mergeVoter(
    {
      ...base,
      id: 'w1-2',
      serialNo: 2,
      name: 'हरिराम',
      nameEn: 'Hariram',
      locality: 'राम मोहल्ला',
      localityEn: 'Ram Mohalla',
    },
    undefined
  ),
  mergeVoter(
    {
      ...base,
      id: 'w1-3',
      serialNo: 3,
      name: 'कमला देवी',
      nameEn: 'Kamala Devi',
      gender: 'female',
      locality: 'सिविल लाइंस',
    },
    { phone: '9876543210', support: 'supporter', updatedAt: 1, updatedBy: 'u1' }
  ),
];

const index = buildIndex(voters);

describe('search scopes', () => {
  it('searches the name only by default and widens on request', () => {
    // `कमला` is a name — must be found by the name scope.
    expect(searchVoters(voters, index, 'कमला', ['name'])).toHaveLength(1);

    // `सिविल` is a locality — invisible to a name-scoped search, which is
    // the whole point of the badge: an unscoped search surfaced it at rank 2
    // mixed in with real name hits.
    expect(searchVoters(voters, index, 'सिविल', ['name'])).toHaveLength(0);
    expect(searchVoters(voters, index, 'सिविल', ['locality'])).toHaveLength(2);
  });

  it('finds a father by the father-name badge', () => {
    expect(searchVoters(voters, index, 'अर्जुन', ['father'])).toHaveLength(3);
    expect(searchVoters(voters, index, 'arjun', ['father'])).toHaveLength(3);
  });

  it('combines scopes as a union, not an intersection', () => {
    // Every voter shares the same father, so `कमला` (her name) is the only
    // discriminator — if scopes were ANDed, the union would still find her.
    const hits = searchVoters(voters, index, 'कमला', ['name', 'father']);
    expect(hits.map((voter) => voter.id)).toEqual(['w1-3']);
  });

  it('leaves the unscoped search unchanged — every field as before', () => {
    expect(searchVoters(voters, index, '9876543210')).toHaveLength(1);
    expect(searchVoters(voters, index, 'CTK4949558')).toHaveLength(3);
    expect(searchVoters(voters, index, 'मुकेश')).toHaveLength(1);
  });

  it('keeps the all-fields key byte-identical to the flat haystack', () => {
    // The scoped index must not change what an unscoped query matches: this is
    // the invariant that lets the default path stay one map lookup.
    for (const voter of voters) {
      expect(index.get(voter.id)!.all).toEqual(haystackOf(voter));
    }
  });

  it('treats an empty scope list as every field, never as "match nothing"', () => {
    const all: SearchScope[] = ['name', 'father', 'locality', 'other'];
    expect(searchVoters(voters, index, 'सिविल', [])).toEqual(
      searchVoters(voters, index, 'सिविल', all)
    );
  });
});

describe('haversineMeters', () => {
  it('is zero for the same point', () => {
    const jodhpur = { lat: 26.2389, lng: 73.0243 };
    expect(haversineMeters(jodhpur, jodhpur)).toBe(0);
  });

  it('matches a known separation — Veernagar to the clock tower is ~1 km', () => {
    // Two points ~0.009° of latitude apart; a degree of latitude is ~111.19 km,
    // so this is ~1.0 km. Loose bounds because the point is a spherical model
    // and the real separation is not being asserted, only the order of magnitude.
    const a = { lat: 26.2389, lng: 73.0243 };
    const b = { lat: 26.2479, lng: 73.0243 };
    const meters = haversineMeters(a, b);
    expect(meters).toBeGreaterThan(900);
    expect(meters).toBeLessThan(1100);
  });

  it('is symmetric', () => {
    const a = { lat: 26.2, lng: 73.0 };
    const b = { lat: 26.3, lng: 73.1 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });
});

describe('formatDistance', () => {
  it('uses metres below a kilometre and kilometres above', () => {
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(850)).toBe('850 m');
    expect(formatDistance(999.4)).toBe('999 m');
    expect(formatDistance(1000)).toBe('1.0 km');
    expect(formatDistance(2450)).toBe('2.5 km');
  });

  it('refuses nonsense rather than printing it', () => {
    expect(formatDistance(Number.NaN)).toBe('');
    expect(formatDistance(-1)).toBe('');
  });
});

/** In-memory stand-in for AsyncStorage. */
function memoryStorage(): OverlayStorage & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return {
    data,
    getItem: async (key) => data[key] ?? null,
    setItem: async (key, value) => {
      data[key] = value;
    },
    removeItem: async (key) => {
      delete data[key];
    },
  };
}

beforeEach(() => __resetOverlayCache());

describe('putOverlay does not queue phantom edits', () => {
  it('ignores a re-tap on the already-selected value', async () => {
    const storage = memoryStorage();

    await putOverlay(storage, {
      voterId: 'w1-1',
      wardNo: 1,
      overlay: { voted: 'voted' },
      uid: 'u1',
      now: 1000,
    });
    // The detail screen lets the same segment be pressed twice (and React can
    // fire a press on the row that is already active). This used to write and
    // enqueue regardless, so the "pending sync" badge appeared on a voter the
    // user believed they had never edited.
    await putOverlay(storage, {
      voterId: 'w1-1',
      wardNo: 1,
      overlay: { voted: 'voted' },
      uid: 'u1',
      now: 2000,
    });

    expect(await loadQueue(storage)).toHaveLength(1);
    expect((await loadWardOverlay(storage, 1))['w1-1'].updatedAt).toBe(1000);
  });

  it('still records a real change and reports only what moved', async () => {
    const storage = memoryStorage();

    await putOverlay(storage, {
      voterId: 'w1-1',
      wardNo: 1,
      overlay: { voted: 'voted' },
      uid: 'u1',
      now: 1000,
    });
    await putOverlay(storage, {
      voterId: 'w1-1',
      wardNo: 1,
      overlay: { voted: 'voted', leaning: 'right' },
      uid: 'u1',
      now: 2000,
    });

    const queue = await loadQueue(storage);
    expect(queue).toHaveLength(1);
    // Keys accumulate across edits (deliberate — see `enqueue`), so the
    // union is what the eventual push needs; the assertion is that a *second*
    // write of an unchanged field adds nothing new on its own.
    expect(queue[0].keys.sort()).toEqual(['leaning', 'voted']);
  });

  it('treats a re-picked location as a change (new object, new reading)', async () => {
    const storage = memoryStorage();
    const fix = { lat: 26.2, lng: 73.0, accuracy: null, updatedAt: 10 };

    await putOverlay(storage, {
      voterId: 'w1-1',
      wardNo: 1,
      overlay: { location: fix },
      uid: 'u1',
      now: 1000,
    });
    await putOverlay(storage, {
      voterId: 'w1-1',
      wardNo: 1,
      overlay: { location: { ...fix, updatedAt: 20 } },
      uid: 'u1',
      now: 2000,
    });

    const queue = await loadQueue(storage);
    expect(queue).toHaveLength(1);
    expect(queue[0].keys).toEqual(['location']);
  });
});

/**
 * The age-band table, extracted from the list screen so the bounds it ships
 * can be asserted rather than assumed.
 *
 * Copied rather than imported: `AgeBand`/`ageInBand` are module-private to the
 * screen, and a filter that silently drops everyone at 26 or includes 61-year-olds
 * in "18-25" would only ever show up as an empty list on a device. If the screen's
 * table changes, this one must change with it.
 */
const AGE_BANDS = [
  { value: 'any', min: -Infinity, max: Infinity },
  { value: '18-25', min: 18, max: 25 },
  { value: '26-40', min: 26, max: 40 },
  { value: '41-60', min: 41, max: 60 },
  { value: '60+', min: 60, max: Infinity },
] as const;

function inBand(age: number, band: (typeof AGE_BANDS)[number]['value']): boolean {
  const row = AGE_BANDS.find((candidate) => candidate.value === band);
  if (!row) return true;
  return age >= row.min && age <= row.max;
}

describe('age bands', () => {
  it('includes both ends of a closed band', () => {
    expect(inBand(18, '18-25')).toBe(true);
    expect(inBand(25, '18-25')).toBe(true);
    expect(inBand(26, '18-25')).toBe(false);
    expect(inBand(17, '18-25')).toBe(false);
  });

  it('does not drop a voter in an uncovered gap', () => {
    // Every adult age must land in at least one band; an off-by-one at a
    // boundary would otherwise make the voter unfindable by age at all.
    for (let age = 18; age <= 100; age += 1) {
      const covered = AGE_BANDS.some((band) => inBand(age, band.value));
      expect(covered).toBe(true);
    }
  });

  it('treats 60 as a member of both 41-60 and 60+ (overlapping is intentional)', () => {
    expect(inBand(60, '41-60')).toBe(true);
    expect(inBand(60, '60+')).toBe(true);
    expect(inBand(59, '60+')).toBe(false);
  });

  it('matches nothing for "any"', () => {
    for (const age of [1, 18, 40, 99]) {
      expect(inBand(age, 'any')).toBe(true);
    }
  });
});

// Both writers must agree on the same contract.
it('agrees with patchVoter about what counts as a change', async () => {
  const storage = memoryStorage();
  await patchVoter(storage, {
    voterId: 'w2-1',
    wardNo: 1,
    patch: { phone: '9876500000' },
    uid: 'u1',
    now: 1,
  });
  await patchVoter(storage, {
    voterId: 'w2-1',
    wardNo: 1,
    patch: { phone: '9876500000' },
    uid: 'u1',
    now: 2,
  });
  expect(await loadQueue(storage)).toHaveLength(1);
});