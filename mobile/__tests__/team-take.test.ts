import { takenPatch } from '@/lib/roll/team-take';
import { mergeVoter } from '@/lib/roll/merge';
import type { RollVoter, TeamOverlayEntry, VoterOverlay } from '@/lib/roll/types';

/**
 * "Save to my account" — the write half of team sharing.
 *
 * What is under test is the DIFF the card copies: a teammate's fields this
 * account does not already have. Two invariants matter more than the count:
 * the take can never overwrite something the account recorded (including a
 * deliberate clear), and it can never carry political profiling (`support`)
 * into an overlay that is pushed to Firestore — where rules would reject the
 * write, so a take that included it would look saved and never sync.
 */

const base: RollVoter = {
  id: 'w3-1',
  wardNo: 3,
  serialNo: 1,
  epicId: 'CTK4949558',
  name: 'मुकेश कुमार',
  relation: 'father',
  relationLabel: 'पिता',
  fatherOrHusbandName: 'अर्जुन शर्मा',
  houseNo: '0',
  age: 54,
  gender: 'male',
  locality: 'बाबा रामदेव नगर',
  pdfPage: 3,
};

/** A teammate's overlay as it arrives from the pull — bookkeeping included. */
const pushed = (fields: Record<string, unknown>): VoterOverlay =>
  ({
    wardNo: 3,
    updatedAt: 2,
    updatedBy: 'uid-teammate',
    ...fields,
  }) as VoterOverlay;

const teammate: TeamOverlayEntry = {
  overlay: pushed({ phone: '9876543210', note: 'Seen at the shop, evening' }),
  authorUid: 'uid-teammate',
  authorName: 'Ramesh',
};

describe('takenPatch', () => {
  it('takes every teammate field this account has not recorded', () => {
    const view = mergeVoter(base, undefined, false, teammate);

    expect(takenPatch(view)).toEqual({
      phone: '9876543210',
      note: 'Seen at the shop, evening',
    });
  });

  it('never overwrites a value this account already has', () => {
    const own: VoterOverlay = {
      phone: '9811112222',
      updatedAt: 3,
      updatedBy: 'uid-me',
    };
    const view = mergeVoter(base, own, false, teammate);

    expect(takenPatch(view)).toEqual({ note: 'Seen at the shop, evening' });
  });

  it('keeps a deliberate own clear — an empty string is a value, not a gap', () => {
    // The merge lets the own `''` win (roll-merge.test.ts pins it); a take
    // that resurrected the teammate's copy here would contradict the row the
    // user is looking at.
    const own: VoterOverlay = {
      phone: '',
      updatedAt: 3,
      updatedBy: 'uid-me',
    };
    const view = mergeVoter(base, own, false, teammate);

    expect(takenPatch(view)).toEqual({ note: 'Seen at the shop, evening' });
  });

  it('never carries political profiling, even when it is on the teammate doc', () => {
    const withSupport: TeamOverlayEntry = {
      overlay: pushed({ phone: '9876543210', support: 'opponent' }),
      authorUid: 'uid-teammate',
      authorName: 'Ramesh',
    };
    const view = mergeVoter(base, undefined, false, withSupport);

    expect(takenPatch(view)).toEqual({ phone: '9876543210' });
  });

  it('copies nothing when there is no teammate entry', () => {
    expect(takenPatch(mergeVoter(base, undefined))).toEqual({});
  });

  it('copies nothing when the teammate adds nothing new', () => {
    const own: VoterOverlay = {
      phone: '9811112222',
      note: 'My own note',
      updatedAt: 3,
      updatedBy: 'uid-me',
    };
    const view = mergeVoter(base, own, false, teammate);

    // `view.team` is unset here — the merge already decided the teammate is
    // not telling this user anything it does not know — so the card does not
    // render, and the patch agrees with that verdict.
    expect(view.team).toBeUndefined();
    expect(takenPatch(view)).toEqual({});
  });
});
