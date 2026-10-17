/**
 * Shared voter phone numbers — the panel's port of `mobile/lib/roll/contacts.ts`.
 *
 * Same three shapes and same pure functions, because the panel and the phone
 * must render one team board identically:
 *
 * - `PhoneProposal`   — `voterPhones/{voterId}/proposals/{uid}`, one per account
 * - `FinalizedContact`— `voterPhones/{voterId}`, the super admin's choice
 * - `groupProposals`  — one row per distinct number, all authors attached
 *
 * Kept dependency-free (except `./contact`'s normalizer) so the drawer UI can
 * derive rows, badges and the dialable number with zero Firestore knowledge.
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
 * Ordering — first what is *in use*, then by most recent authorship. Authors
 * inside a group sort newest-first (the Firestore doc is one-per-uid, so a
 * duplicate only ever appears after a merge, where newest-first is right).
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
 * The number the call / WhatsApp buttons dial: the finalized number wins —
 * that is the entire point of finalizing — the overlay's own number is the
 * fallback for a voter whose numbers exist nowhere shared yet.
 */
export function activePhone(
  finalPhone: string | null | undefined,
  ownPhone: string | null | undefined
): string {
  const final = finalPhone ? phoneKey(finalPhone) : '';
  if (final) return final;
  return ownPhone ? phoneKey(ownPhone) : '';
}

/**
 * Valid proposal form. Validates the RAW input first, then the normalized key
 * — testing only the normalized form would pass `98765abc210`, because
 * normalization strips letters before the pattern ever sees them.
 */
export function isValidPhone(phone: string): boolean {
  const trimmed = phone.trim();
  if (!/^\+?[\d\s\-()]{6,30}$/.test(trimmed)) return false;
  return /^\+?[0-9]{6,15}$/.test(phoneKey(trimmed));
}