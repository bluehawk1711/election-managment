/**
 * Shared voter phone numbers (team proposals + super-admin final choice).
 *
 * The roll carries no phone numbers (plan-voters.md §4), and for a long time
 * every number lived only inside the editor's *own* overlay — so a karykarta's
 * number and a super admin's number could never appear together on one voter.
 * This module is the shared layer's pure logic:
 *
 * - `PhoneProposal` — one account's proposed number (Firestore doc
 *   `voterPhones/{voterId}/proposals/{uid}`), attributed with the author's
 *   name and when it was written.
 * - `FinalizedContact` — the number a super admin put "in use"
 *   (`voterPhones/{voterId}`), with who chose it and when.
 * - `groupProposals` — collapses the proposals into one row **per distinct
 *   number**, because the most common real-world case is two people recording
 *   the *same* landline; the row then carries both authors rather than
 *   pretending there were two numbers.
 *
 * Everything here is pure and synchronous so `__tests__/contacts-group.test.ts`
 * can pin the behaviour without Firestore: the screen's attribution line, the
 * "in use" badge and the number the call/WhatsApp buttons dial all derive from
 * these functions, so a change to them is a tested change to the UI.
 */
import { normalizePhone } from '@/lib/contact';

/** One account's proposed number for one voter. */
export interface PhoneProposal {
  /** The proposing account — also the Firestore document id. */
  uid: string;
  /** Digits as validated by rules (`^[+]?[0-9]{6,15}$`). */
  phone: string;
  /** Display name of the proposer at the time they wrote it. */
  authorName: string;
  /** Ward this voter belongs to — denormalised so rules can scope reads. */
  wardNo: number;
  /** Client epoch millis (the same convention as the overlay). */
  updatedAt: number;
}

/** The super-admin's chosen number for one voter. */
export interface FinalizedContact {
  wardNo: number;
  /** `''` when the choice has been cleared. */
  finalPhone: string;
  finalizedBy: string;
  finalizedName: string;
  /** Client epoch millis, `null` when never set / cleared. */
  finalizedAt: number | null;
}

/** One distinct number with everyone who proposed it, newest first. */
export interface PhoneGroup {
  key: string;
  /** The number to render and dial — normalized digits. */
  phone: string;
  authors: PhoneProposal[];
  /** True when a super admin has put this number in use. */
  isFinal: boolean;
}

/** Normalization used for identity: `98765 43210` === `9876543210`. */
export function phoneKey(phone: string): string {
  return normalizePhone(phone);
}

/**
 * Folds proposals into one group per distinct number.
 *
 * Ordering — first what is *in use* (that is the number the screen acts on),
 * then by the most recent authorship, so a number someone touched yesterday
 * outranks one nobody has looked at since it was imported. A group's display
 * number is the first-seen spelling after normalization, and authors are
 * sorted newest-first (same author writing twice keeps their latest — the
 * Firestore doc is one-per-uid, so this only matters after a merge).
 */
export function groupProposals(
  proposals: readonly PhoneProposal[],
  finalPhone: string | null | undefined
): PhoneGroup[] {
  const finalKey = finalPhone ? phoneKey(finalPhone) : '';

  const byKey = new Map<string, PhoneGroup>();
  for (const proposal of proposals) {
    const key = phoneKey(proposal.phone);
    if (!key) continue;
    const existing = byKey.get(key);
    if (existing) {
      existing.authors.push(proposal);
      continue;
    }
    byKey.set(key, {
      key,
      phone: key,
      authors: [proposal],
      isFinal: finalKey !== '' && key === finalKey,
    });
  }

  for (const group of byKey.values()) {
    group.authors.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  return [...byKey.values()].sort((a, b) => {
    if (a.isFinal !== b.isFinal) return a.isFinal ? -1 : 1;
    const newestA = a.authors[0]?.updatedAt ?? 0;
    const newestB = b.authors[0]?.updatedAt ?? 0;
    return newestB - newestA;
  });
}

/**
 * The number the call / WhatsApp / message buttons dial.
 *
 * The finalized number wins when there is one — that is the entire point of
 * finalizing — and the caller's own staged/recorded number is the fallback so
 * a voter whose numbers only exist on this device still has working buttons.
 */
export function activePhone(
  finalPhone: string | null | undefined,
  ownPhone: string | null | undefined
): string {
  const final = finalPhone ? phoneKey(finalPhone) : '';
  if (final) return final;
  return ownPhone ? phoneKey(ownPhone) : '';
}

/** A proposals document is legal per rules — also used by tests and bulk writes.
 *
 * Validates the RAW input first, then the normalized key. Testing only the
 * normalized form would pass junk like `98765abc210`, because
 * normalization strips letters before the pattern ever sees them — the
 * digits of a typo'd number alone are a perfectly valid number of *somebody
 * else's*. The first pattern allows the separators people actually type
 * (spaces, dashes, brackets, a leading `+`); the second re-checks what will
 * actually be stored, because that is what `firestore.rules` matches
 * against.
 */
export function isValidPhone(phone: string): boolean {
  const trimmed = phone.trim();
  if (!/^\+?[\d\s\-()]{6,30}$/.test(trimmed)) return false;
  return /^\+?[0-9]{6,15}$/.test(phoneKey(trimmed));
}