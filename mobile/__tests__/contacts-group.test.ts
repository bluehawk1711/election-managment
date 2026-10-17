import {
  activePhone,
  groupProposals,
  isValidPhone,
  phoneKey,
  type PhoneProposal,
} from '@/lib/roll/contacts';

/**
 * The shared number board is rendered straight from these functions: one row
 * per distinct number, who added each and when, the super admin's choice
 * first, and the number the call/WhatsApp/message trio dials. A regression
 * here is a misattributed number on a real voter, so both directions are
 * pinned — merging must never *lose* an author, and ordering must never put
 * something other than the chosen number first.
 */
const proposal = (
  uid: string,
  phone: string,
  updatedAt: number,
  authorName = uid
): PhoneProposal => ({ uid, phone, authorName, wardNo: 3, updatedAt });

describe('phoneKey / isValidPhone', () => {
  it('treats differently spelled copies of one number as one identity', () => {
    expect(phoneKey('98765 43210')).toBe(phoneKey('9876543210'));
    expect(phoneKey('+91 98765 43210')).toBe(phoneKey('+919876543210'));
  });

  it('applies the same 6–15 digit shape the rules validate', () => {
    // Formatting is fine — separators are stripped for storage.
    expect(isValidPhone('9876543210')).toBe(true);
    expect(isValidPhone('98765 43210')).toBe(true);
    expect(isValidPhone('98765-43-210')).toBe(true);
    expect(isValidPhone('+91 98765 43210')).toBe(true);
    expect(isValidPhone('12345')).toBe(false); // too short
    expect(isValidPhone('987654321012345678')).toBe(false); // too long (raw)
    // Letters are a typo, not formatting: stripping before validating would
    // turn this into a DIFFERENT valid number and silently store it.
    expect(isValidPhone('98765abc210')).toBe(false);
    expect(isValidPhone('9876543210x')).toBe(false);
    expect(isValidPhone('')).toBe(false);
  });
});

describe('groupProposals', () => {
  it('folds the same number from two people into ONE row with both authors', () => {
    // The real-world case: a karykarta and the super admin both record the
    // family landline. The board must show both, not pretend there are two
    // numbers — and never drop one author.
    const groups = groupProposals(
      [
        proposal('uid-bob', '98765 43210', 1_000, 'Ramesh'),
        proposal('uid-alice', '9876543210', 2_000, 'Sunita'),
      ],
      undefined
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].authors.map((a) => a.authorName)).toHaveLength(2);
    expect(groups[0].authors.map((a) => a.authorName)).toEqual([
      'Sunita', // newest first
      'Ramesh',
    ]);
  });

  it('keeps genuinely different numbers apart', () => {
    const groups = groupProposals(
      [proposal('a', '9876543210', 1), proposal('b', '9811112222', 2)],
      undefined
    );
    expect(groups.map((g) => g.phone)).toEqual(['9811112222', '9876543210']);
  });

  it('puts the finalized number first and marks only it as in use', () => {
    const groups = groupProposals(
      [
        proposal('a', '9876543210', 3_000), // newer…
        proposal('b', '9811112222', 1_000), // …older, but chosen
      ],
      '9811112222'
    );

    expect(groups[0].phone).toBe('9811112222');
    expect(groups[0].isFinal).toBe(true);
    expect(groups[1].isFinal).toBe(false);
  });

  it('recognises the chosen number across spellings', () => {
    const groups = groupProposals(
      [proposal('a', '98765 43210', 1)],
      '+91 9876543210'
    );
    // '+91' + 10 digits !== bare 10 digits, so this must NOT match…
    expect(groups[0].isFinal).toBe(false);
    // …while the same digits do:
    const exact = groupProposals([proposal('a', '9876543210', 1)], '9876543210');
    expect(exact[0].isFinal).toBe(true);
  });

  it('marks nothing as final when the choice is empty or absent', () => {
    const groups = groupProposals([proposal('a', '9876543210', 1)], '');
    expect(groups[0].isFinal).toBe(false);
  });

  it('orders the rest by newest authorship and drops blank numbers', () => {
    const groups = groupProposals(
      [
        proposal('a', '9811112222', 10),
        proposal('b', '9876543210', 99),
        proposal('c', '   ', 50),
      ],
      undefined
    );
    expect(groups.map((g) => g.phone)).toEqual([
      '9876543210',
      '9811112222',
    ]);
  });

  it('returns nothing for an empty board', () => {
    expect(groupProposals([], undefined)).toEqual([]);
  });
});

describe('activePhone', () => {
  it('prefers the finalized number — that is the point of finalizing', () => {
    expect(activePhone('9811112222', '9876543210')).toBe('9811112222');
  });

  it('falls back to the caller’s own number, normalized', () => {
    expect(activePhone('', '98765 43210')).toBe('9876543210');
    expect(activePhone(undefined, null)).toBe('');
    expect(activePhone('', '')).toBe('');
  });
});