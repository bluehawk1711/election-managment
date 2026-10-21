/**
 * `writeProposal` — the shared-phone-number write, callable from anywhere.
 *
 * Split out of `hooks/useVoterContacts` for two callers that are *not* editing
 * the voter on screen: the bulk-phone screen and the edit sheet's "whole
 * house" action. Both write a number for OTHER voters, and a hook bound to one
 * voter id cannot address those — this function takes the target explicitly
 * and reads identity from `lib/firebase`'s auth singleton, mirroring how
 * `lib/roll/sync.ts` works.
 *
 * The checks here are pre-flight only, never the boundary: `database.rules.json`
 * re-checks role, ward scoping, owner path and the phone shape on every write,
 * and `scripts/probe-writes.mjs` asserts the proposal path. Skipping an
 * obviously-illegal write before it leaves the device turns a server rejection
 * (and its console error) into a quiet no-op.
 */
import { auth } from '@/lib/firebase';
import { setDoc } from '@/lib/db';
import { can, type AppRole } from '@/lib/roles';
import { isValidPhone, phoneKey } from '@/lib/roll/contacts';

export interface ProposalWrite {
  voterId: string;
  wardNo: number;
  phone: string;
  /** The proposer's display name — attribution shown to the whole team. */
  authorName: string;
  /** The proposer's own role and ward, for the client-side pre-flight. */
  role: AppRole | null;
  myWardNo: number | null;
}

/**
 * Upserts **your own** proposal for one voter.
 *
 * Returns `false` when the write was skipped as illegal (not signed in, no
 * `voterEdit`, karykarta outside their ward, number shape rules would
 * reject) — callers that mirror-share treat `false` as "kept local only" and
 * must not fail the local save over it. Throws only on a real error, which
 * the best-effort call sites catch.
 */
export async function writeProposal(args: ProposalWrite): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;
  if (!can(args.role, 'voterEdit')) return false;
  if (args.role === 'karykarta' && args.myWardNo !== args.wardNo) return false;

  // Validate the RAW input before normalizing: `phoneKey` strips letters
  // too, so checking the normalized form would accept `98765abc210` as
  // `98765210` — a perfectly valid number that belongs to somebody else.
  if (!isValidPhone(args.phone)) return false;
  const phone = phoneKey(args.phone);

  // A full write, not a merge — the whole proposal document is this account's
  // one proposal, so replacing it is the intended semantics.
  await setDoc(`voterPhones/${args.voterId}/proposals/${user.uid}`, {
    phone,
    authorName: args.authorName.trim() || 'Unknown',
    wardNo: args.wardNo,
    updatedAt: Date.now(),
  });
  return true;
}