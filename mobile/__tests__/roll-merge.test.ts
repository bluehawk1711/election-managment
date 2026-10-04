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
    expect(view.support).toBe('unknown');
    expect(view.effective.jati).toBe('');
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

  it('carries jati and support from the overlay', () => {
    const view = mergeVoter(base, {
      jati: 'राजपूत',
      support: 'supporter',
      updatedAt: 1,
      updatedBy: 'u1',
    });

    expect(view.effective.jati).toBe('राजपूत');
    expect(view.support).toBe('supporter');
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
      { phone: '9876543210', leaning: 'right', jati: 'जाट', support: 'opponent', updatedAt: 1, updatedBy: 'u1' }
    ),
  ];
  const index = buildIndex(voters);

  it('normalises case, punctuation and spacing', () => {
    expect(normalizeToken('  Ram,  MOHALLA! ')).toBe('ram mohalla');
  });

  it('includes every field in the haystack', () => {
    // The haystack is a pair of keyed forms, so assertions target the fields.
    // Checked on the phonetic side because that is script-independent.
    const hay = haystackOf(voters[0]);
    expect(hay.phonetic).toContain('ctk4949558'); // epicId
    // The native key is matra- and space-stripped by design, so it is asserted
    // in its keyed form rather than as the raw text.
    expect(hay.native).toContain('रमदवनगरसगरय'); // locality
    expect(hay.native).toContain('अरजनशरम'); // father
    expect(hay.phonetic).toContain('54'); // age
    expect(hay.native).toContain('त'); // relation label पिता, keyed
    // ward + serial + pdf page are searchable too — "every field" means it.
    const tagged = haystackOf(
      mergeVoter({ ...base, wardNo: 42, serialNo: 77, pdfPage: 301 }, undefined)
    );
    expect(tagged.phonetic).toContain('42');
    expect(tagged.phonetic).toContain('77');
    expect(tagged.phonetic).toContain('301');
  });

  it('matches on fields the CSV does not index directly', () => {
    expect(searchVoters(voters, index, '9876543210')).toHaveLength(1);
    expect(searchVoters(voters, index, 'right')).toHaveLength(1);
    // The two fields the edit sheet added: caste text and support side.
    expect(searchVoters(voters, index, 'जाट')).toHaveLength(1);
    expect(searchVoters(voters, index, 'opponent')).toHaveLength(1);
  });

  it('finds a voter from either keyboard', () => {
    // The feature: the row is Devanagari, the query is Roman and vice versa.
    expect(searchVoters(voters, index, 'mukesh')).toHaveLength(1);
    expect(searchVoters(voters, index, 'MUKESH KUMAR')).toHaveLength(1);
    expect(searchVoters(voters, index, 'हरिराम')).toHaveLength(1);
    expect(searchVoters(voters, index, 'hariram')).toHaveLength(1);
    // A matra-less spelling of the same name still finds the row.
    expect(searchVoters(voters, index, 'कमला')).toHaveLength(1);
    expect(searchVoters(voters, index, 'kamla')).toHaveLength(1);
  });

  it('matches by EPIC id, which is digits and always exact', () => {
    expect(searchVoters(voters, index, 'ctk4949558')).toHaveLength(3);
    expect(searchVoters(voters, index, 'CTK4949558')).toHaveLength(3);
  });

  it('requires every token to match (token AND)', () => {
    // Two tokens, no single row carries both.
    expect(searchVoters(voters, index, 'हरिराम कमला')).toHaveLength(0);
    expect(searchVoters(voters, index, 'कमला सिविल')).toHaveLength(1);
  });

  it('widens as a phonetic key, and that is a deliberate trade-off', () => {
    // Documented consequence of dropping vowels: 'राम' reduces to "rm", which is
    // a substring of शर्मा ("rm") too, so the father field of every row here
    // matches. Ranking keeps the genuinely-close rows at the top, and the EPIC
    // id is the exact discriminator, which is why this is acceptable — but it
    // is a real widening and the test pins it so it cannot change unnoticed.
    expect(searchVoters(voters, index, 'राम')).toHaveLength(3);
  });

  it('ranks the exact row above a looser phonetic hit', () => {
    const byName = searchVoters(voters, index, 'मुकेश');
    expect(byName[0].id).toBe('w1-7');
  });

  it('keeps roll order among equally-ranked rows', () => {
    // All three share an EPIC id, so they rank the same; the list must not
    // reshuffle between keystrokes.
    expect(searchVoters(voters, index, 'ctk4949558').map((v) => v.id)).toEqual([
      'w1-7',
      'w1-8',
      'w1-9',
    ]);
  });

  it('returns everything for a blank query', () => {
    expect(searchVoters(voters, index, '   ')).toHaveLength(3);
  });
});
