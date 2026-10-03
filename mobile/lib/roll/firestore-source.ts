/**
 * The Firestore `RollSource` (plan-voters.md §2, V7 onward).
 *
 * Same interface as the bundle source, so screens do not change when
 * `EXPO_PUBLIC_ROLL_SOURCE=firestore`. It is deliberately *not* the default:
 * until `scripts/seed-roll.mjs` has run against the project, this returns
 * nothing, and the default bundle keeps the app usable offline.
 *
 * Reads only. The base roll is imported data — `firestore.rules` denies
 * client writes to `voters` for exactly that reason, so no code path here
 * (or anywhere above this module) can mutate it.
 */
import { COLLECTIONS } from '@/lib/collections';
import { db } from '@/lib/firebase';
import {
  collection,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import type { RollSource, RollVoter, WardsBundle, WardMeta } from '@/lib/roll/types';

const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;
const num = (value: unknown, fallback = 0): number =>
  typeof value === 'number' ? value : fallback;

/**
 * Firestore document → `RollVoter`.
 *
 * The seeded document shape mirrors the CSV columns (`plan-voters.md` §4); a
 * missing field degrades to an empty value rather than throwing, because a
 * partially-imported row must still render and be findable.
 */
export function rollVoterFromDoc(
  doc: QueryDocumentSnapshot<DocumentData>
): RollVoter {
  const data = doc.data();
  const wardNo = num(data.wardNo);
  const serialNo = num(data.serialNo);

  const relationLabel = str(data.relationLabel);
  const relation =
    relationLabel === 'पति'
      ? 'husband'
      : relationLabel === 'माता'
        ? 'mother'
        : relationLabel === 'अन्य'
          ? 'other'
          : 'father';

  const genderLabel = str(data.genderLabel, str(data.gender));
  const gender = genderLabel === 'female' || genderLabel === 'स्त्री'
    ? 'female'
    : genderLabel === 'other' || genderLabel === 'तृतीयलिंग'
      ? 'other'
      : 'male';

  return {
    // Prefer the seeded id; fall back to the same `w{ward}-{serial}` scheme
    // the bundle uses so overlay keys match across both sources.
    id: doc.id || `w${wardNo}-${serialNo}`,
    wardNo,
    serialNo,
    epicId: str(data.epicId, str(data.rollId)),
    name: str(data.name),
    relation,
    relationLabel: relationLabel || 'पिता',
    fatherOrHusbandName: str(data.fatherOrHusbandName, str(data.fatherName)),
    houseNo: str(data.houseNo),
    age: num(data.age),
    gender,
    locality: str(data.locality),
    pdfPage: num(data.pdfPage),
  };
}

/** Fetches one query, mapped. `field`/`value` are an equality filter. */
async function fetchVoters(options?: {
  field?: string;
  value?: string | number;
  cap?: number;
}): Promise<RollVoter[]> {
  const constraints = [];
  if (options?.field && options.value !== undefined) {
    constraints.push(where(options.field, '==', options.value));
  }
  constraints.push(fsLimit(options?.cap ?? 10000));

  const snapshot = await getDocs(
    query(collection(db, COLLECTIONS.voters), ...constraints)
  );
  return snapshot.docs.map(rollVoterFromDoc);
}

export const firestoreSource: RollSource = {
  kind: 'firestore',

  async getWards(): Promise<WardsBundle> {
    // Ordered by `wardNo`, **not** `name`.
    //
    // `name` is the Hindi string `वार्ड 7`, so a lexicographic sort returns
    // 1, 10, 11, 12, 13, 2, 3 … — which is exactly how it presented: the ward
    // picker appeared to contain five wards and no others, because the first
    // page of a dropdown was 1, 10, 11, 12, 13. `wardNo` is a number field, so
    // Firestore sorts it numerically and the list reads 1…13.
    //
    // The sort is also applied client-side below rather than trusted from the
    // query, because the per-ward cache stitches bundles together and the
    // result must not depend on which one answered first.
    const snapshot = await getDocs(
      query(collection(db, COLLECTIONS.wards), orderBy('wardNo'))
    );
    const wards: WardMeta[] = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        wardNo: num(data.wardNo),
        voterCount: num(data.voterCount),
        male: num(data.male),
        female: num(data.female),
        thirdGender: num(data.thirdGender),
        delimitation: str(data.delimitation),
        boothNo: num(data.boothNo),
        roomNo: num(data.roomNo),
        boothAddress: str(data.boothAddress),
        pdfPages: str(data.pdfPages),
      };
    });

    wards.sort((a, b) => a.wardNo - b.wardNo);

    return {
      generatedAt: '',
      source: COLLECTIONS.wards,
      total: wards.reduce((sum, ward) => sum + ward.voterCount, 0),
      tally: {
        male: wards.reduce((sum, ward) => sum + ward.male, 0),
        female: wards.reduce((sum, ward) => sum + ward.female, 0),
        other: wards.reduce((sum, ward) => sum + ward.thirdGender, 0),
      },
      wards,
    };
  },

  getVoters(wardNo: number | null): Promise<RollVoter[]> {
    if (wardNo == null) return fetchVoters();
    return fetchVoters({ field: 'wardNo', value: wardNo });
  },
};
