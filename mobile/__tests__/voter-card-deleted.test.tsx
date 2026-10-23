/**
 * The DELETED badge on the roll's card (EXTRACTION.md §Step 8).
 *
 * `VeerNagar-photos.pdf` stamps 107 record cells with a diagonal DELETED
 * mark; the flag rides into the bundle as `RollVoter.deleted` and the card
 * layers a big badge over itself when it is set. What is asserted here is
 * the contract that makes that visible: the badge renders when — and only
 * when — the base row carries the flag. The stamp being decorative
 * (`pointerEvents='none'`, centred + rotated) is deliberately not asserted:
 * its position is a design detail, its presence is the data.
 *
 * `@/i18n` because `VoterCard` reads every label through `useTranslation`,
 * which needs an initialised i18next instance — the module registers one on
 * import (Hindi first, same as a fresh install).
 */
import { render, screen } from '@testing-library/react-native';

import '@/i18n';
import { VoterCard } from '@/components/roll/voter-card';
import type { VoterView } from '@/lib/roll/types';

// `lucide-react-native` ships untranspiled ESM (`.mjs`), which Jest refuses
// to parse — and `transformIgnorePatterns` only whitelists the RN/Expo tree.
// The icon is furniture here (a stub host component stands in for `UserX`);
// the badge itself never goes near it. Hoisted above the imports by Jest
// regardless of where it sits.
jest.mock('lucide-react-native', () => ({ UserX: 'UserX' }));

/** Ward 1, serial 599 — the record the photos PDF stamps DELETED. */
const VOTER: VoterView = {
  id: 'w1-599',
  wardNo: 1,
  serialNo: 599,
  epicId: 'IRW1338359',
  name: 'सुमन',
  relation: 'husband',
  relationLabel: 'पति',
  fatherOrHusbandName: 'रामरख',
  houseNo: '',
  age: 35,
  gender: 'female',
  locality: 'प्रेम नगर,सांगरिया',
  pdfPage: 25,
  // Bookkeeping only — the card never reads it; the type requires it.
  overlay: { updatedAt: 0, updatedBy: '' },
  effective: {
    name: 'सुमन',
    fatherOrHusbandName: 'रामरख',
    houseNo: '',
    age: 35,
    gender: 'female',
    locality: 'प्रेम नगर,सांगरिया',
    phone: '',
    jati: '',
  },
  voted: 'unknown',
  leaning: 'unknown',
  support: 'unknown',
  photoUrl: null,
  location: null,
  pending: false,
};

function renderCard(voter: VoterView) {
  // `render` is async in RNTL 14 (React 19's concurrent root mounts inside
  // `act`), so the badge assertions must wait for it — unawaited, `screen`
  // still has no render to query.
  return render(<VoterCard voter={voter} onPress={() => {}} />);
}

describe('VoterCard DELETED badge', () => {
  it('stamps DELETED across the card when the roll marks the voter struck', async () => {
    await renderCard({ ...VOTER, deleted: true });

    expect(screen.getByText('DELETED')).toBeTruthy();
  });

  it('stays unstamped for every voter the roll does not mark', async () => {
    await renderCard(VOTER);

    expect(screen.queryByText('DELETED')).toBeNull();
  });

  it('says deleted in the card’s accessibility label too', async () => {
    await renderCard({ ...VOTER, deleted: true });

    const card = screen.getByRole('button');
    expect(card.props.accessibilityLabel).toContain('DELETED');
  });
});
