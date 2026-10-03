import { isEdited, mergeVoter } from '@/lib/roll/merge';
import { buildIndex, haystackOf, normalizeToken, searchVoters } from '@/lib/roll/search';
import type { RollVoter, VoterView } from '@/lib/roll/types';

const base: RollVoter = {
  id: 'w1-7',
  wardNo: 1,
  serialNo: 7,
  epicId: 'CTK4949558',
  name: 'मुकेश कुमार',
  relation: 'father',
  relationLabel: 'पिता',
  fatherOrHusbandName: 'अर्जुन शर्मा',
  houseNo: '0',
  age: 54,
  gender: 'male',
  locality: 'बाबा रामदेव नगर,सांगरिया',
  pdfPage: 3,
};

describe('mergeVoter', () => {
  it('returns the base row untouched when there is no overlay', () => {
    const view = mergeVoter(base, undefined);

    expect(view.effective.name).toBe('मुकेश कुमार');
    expect(view.effective.age).toBe(54);
    expect(view.voted).toBe('unknown');
    expect(view.leaning).toBe('unknown');
    expect(view.photoUrl).toBeNull();
    expect(view.location).toBeNull();
    expect(view.pending).toBe(false);
  });

  it('lets the overlay win on fields it carries and keeps the rest', () => {
    const view = mergeVoter(base, {
      name: 'मुकेश कुमार शर्मा',
      age: 55,
      updatedAt: 1,
      updatedBy: 'u1',
    });

    expect(view.effective.name).toBe('मुकेश कुमार शर्मा');
    expect(view.effective.age).toBe(55);
    expect(view.effective.fatherOrHusbandName).toBe('अर्जुन शर्मा');
    expect(view.effective.locality).toBe(base.locality);
  });

  it('treats an empty overlay string as "not overridden"', () => {
    const view = mergeVoter(base, { name: '', updatedAt: 1, updatedBy: 'u1' });
    expect(view.effective.name).toBe(base.name);
  });

  it('falls back to the base age when the overlay age is nonsense', () => {
    const view = mergeVoter(base, { age: Number.NaN, updatedAt: 1, updatedBy: 'u1' });
    expect(view.effective.age).toBe(54);
  });

  it('never mutates the base row', () => {
    const snapshot = JSON.stringify(base);
    mergeVoter(base, { name: 'changed', age: 99, updatedAt: 1, updatedBy: 'u1' });
    expect(JSON.stringify(base)).toBe(snapshot);
  });
});

describe('isEdited', () => {
  it('is false for an empty or bookkeeping-only overlay', () => {
    expect(isEdited(undefined)).toBe(false);
    expect(isEdited({ updatedAt: 1, updatedBy: 'u' })).toBe(false);
  });

  it('is true once any field is written', () => {
    expect(isEdited({ voted: 'voted', updatedAt: 1, updatedBy: 'u' })).toBe(true);
  });
});

describe('search', () => {
  const voters: VoterView[] = [
    mergeVoter(base, undefined),
    mergeVoter(
      { ...base, id: 'w1-8', serialNo: 8, name: 'हरिराम', locality: 'राम मोहल्ला' },
      undefined
    ),
    mergeVoter(
      {
        ...base,
        id: 'w1-9',
        serialNo: 9,
        name: 'कमला देवी',
        gender: 'female',
        locality: 'सिविल लाइंस',
      },
      { phone: '9876543210', leaning: 'right', updatedAt: 1, updatedBy: 'u1' }
    ),
  ];
  const index = buildIndex(voters);

  it('normalises case, punctuation and spacing', () => {
    expect(normalizeToken('  Ram,  MOHALLA! ')).toBe('ram mohalla');
  });

  it('includes every field in the haystack', () => {
    const hay = haystackOf(voters[0]);
    expect(hay).toContain('ctk4949558'); // epicId
    expect(hay).toContain('बाबा रामदेव नगर'); // locality
    expect(hay).toContain('अर्जुन शर्मा'); // father
    expect(hay).toContain('54'); // age
    expect(hay).toContain('पिता'); // relation label as printed
    // ward + serial + pdf page are searchable too — "every field" means it.
    const tagged = haystackOf(
      mergeVoter({ ...base, wardNo: 42, serialNo: 77, pdfPage: 301 }, undefined)
    );
    expect(tagged).toContain('42');
    expect(tagged).toContain('77');
    expect(tagged).toContain('301');
  });

  it('matches on fields the CSV does not index directly', () => {
    expect(searchVoters(voters, index, '9876543210')).toHaveLength(1);
    expect(searchVoters(voters, index, 'right')).toHaveLength(1);
  });

  it('requires every token to match (token AND)', () => {
    // "राम" alone matches rows 1 and 2 (localities रामदेव / राम मोहल्ला —
    // and "हरिराम" contains it too), so a single token is not the test.
    expect(searchVoters(voters, index, 'राम')).toHaveLength(2);
    // Adding a second token narrows to the row carrying both.
    expect(searchVoters(voters, index, 'राम हरिराम')).toHaveLength(1);
    // A pair no single row carries matches nothing.
    expect(searchVoters(voters, index, 'हरिराम कमला')).toHaveLength(0);
    expect(searchVoters(voters, index, 'कमला सिविल')).toHaveLength(1);
  });

  it('returns everything for a blank query', () => {
    expect(searchVoters(voters, index, '   ')).toHaveLength(3);
  });
});
