/**
 * `useVoterContacts` — the shared phone-number layer for one voter.
 *
 * Reads `voterPhones/{voterId}` (the super admin's chosen number) and its
 * `proposals/{uid}` subcollection (every account's proposed number) live, and
 * exposes the two writes:
 *
 * - `propose(phone)` — upsert **your own** proposal. Rules key the proposal
 *   document by uid, so "only your own" is a path check, not a diff. No-op
 *   when the number has not changed, so re-saving the form does not bump
 *   timestamps or re-notify the list.
 * - `finalize(group)` / `clearFinalize()` — super admin only
 *   (`contactFinalize`); writes the whole parent document so the exact key set
 *   rules demand (`wardNo, finalPhone, finalizedBy, finalizedName,
 *   finalizedAt`) is always complete, on create and on update alike.
 *
 * Everything is scoped: a roleless account or one without `voterEdit` never
 * subscribes (the rules would deny it and the listener would only produce
 * errors), and `wardNo` rides on every document so a karykarta's read and
 * write are both pinned to their own ward server-side.
 *
 * Failure behaviour matches the rest of the roll: local overlay state is the
 * source of truth for *your* number, this layer is the shared mirror — a
 * rejected proposal write leaves the screen working, it just does not share.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { can } from '@/lib/roles';
import { phoneKey, type FinalizedContact, type PhoneGroup, type PhoneProposal, groupProposals } from '@/lib/roll/contacts';
import { writeProposal } from '@/lib/roll/contacts-store';
import { useAuth } from '@/providers/auth-provider';

export interface VoterContacts {
  /** True until the first snapshot of both halves lands. */
  loading: boolean;
  proposals: PhoneProposal[];
  finalized: FinalizedContact | null;
  /** Proposals folded per distinct number, final first — render this. */
  groups: PhoneGroup[];
  /** `activePhone(finalized, fallback)` — what the action buttons dial. */
  active: (fallback: string) => string;
  /** The finalized number, or `''`. */
  finalPhone: string;
  canFinalize: boolean;
  propose: (
    phone: string,
    wardNo: number,
    targetVoterId?: string
  ) => Promise<boolean>;
  finalize: (group: PhoneGroup, wardNo: number) => Promise<boolean>;
  clearFinalize: (wardNo: number) => Promise<boolean>;
}

export function useVoterContacts(
  voterId: string,
  wardNo: number | null
): VoterContacts {
  const { user, profile } = useAuth();
  const role = profile?.role ?? null;
  const enabled = Boolean(voterId && wardNo != null && can(role, 'voterEdit'));

  const [proposals, setProposals] = useState<PhoneProposal[]>([]);
  const [finalized, setFinalized] = useState<FinalizedContact | null>(null);
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled || wardNo == null) {
      setProposals([]);
      setFinalized(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    // The editor may render as soon as *either* half lands: the parent doc
    // (chosen number) and the proposals list are independent, and an empty
    // list is a legitimate first answer — holding the card hostage to the
    // second snapshot would make it flash.
    let parentSettled = false;
    let proposalsSettled = false;
    const settle = (which: 'parent' | 'proposals') => {
      if (which === 'parent') parentSettled = true;
      else proposalsSettled = true;
      if (parentSettled && proposalsSettled) setLoading(false);
    };

    const parent = doc(db, 'voterPhones', voterId);
    const stopParent = onSnapshot(
      parent,
      (snapshot) => {
        setFinalized(snapshot.exists() ? (snapshot.data() as FinalizedContact) : null);
        settle('parent');
      },
      () => {
        // A rules rejection here must not crash the editor — treat it as
        // "nothing shared yet"; the local overlay still drives the form.
        setFinalized(null);
        settle('parent');
      }
    );

    const stopProposals = onSnapshot(
      // No orderBy: rules scope the list per returned document, and sorting
      // happens in `groupProposals` — an ordered query would additionally
      // need the order field on every doc AND a composite index later.
      collection(db, 'voterPhones', voterId, 'proposals'),
      (snapshot) => {
        const next: PhoneProposal[] = [];
        for (const item of snapshot.docs) {
          const data = item.data() as Omit<PhoneProposal, 'uid'>;
          if (typeof data.phone !== 'string' || typeof data.updatedAt !== 'number') continue;
          next.push({ ...data, uid: item.id });
        }
        setProposals(next);
        settle('proposals');
      },
      () => {
        setProposals([]);
        settle('proposals');
      }
    );

    return () => {
      stopParent();
      stopProposals();
    };
  }, [enabled, voterId, wardNo]);

  const authorName = profile?.displayName || user?.email || 'Someone';

  const propose = useCallback(
    async (
      phone: string,
      targetWard: number,
      /** Defaults to this hook's voter; the house/bulk paths pass others. */
      targetVoterId?: string
    ): Promise<boolean> => {
      const vid = targetVoterId ?? voterId;
      // Skip an unchanged re-submit — but only for the voter whose proposals
      // are actually loaded here; an id-less check for a *different* voter
      // would compare against the wrong list and silently skip a real share.
      if (vid === voterId && user) {
        const existing = proposals.find((row) => row.uid === user.uid);
        if (existing && phoneKey(existing.phone) === phoneKey(phone)) return true;
      }
      return writeProposal({
        voterId: vid,
        wardNo: targetWard,
        phone,
        authorName,
        role,
        myWardNo: profile?.wardNo ?? null,
      });
    },
    [user, role, profile?.wardNo, proposals, authorName, voterId]
  );

  const finalize = useCallback(
    async (group: PhoneGroup, targetWard: number): Promise<boolean> => {
      if (!user || !can(role, 'contactFinalize')) return false;
      if (!group.phone) return false;
      await setDoc(
        doc(db, 'voterPhones', voterId),
        {
          wardNo: targetWard,
          finalPhone: group.phone,
          finalizedBy: user.uid,
          finalizedName: authorName,
          finalizedAt: Date.now(),
        },
        // Whole-document write (not merge): rules demand the exact five-key
        // set on the RESULT, so a partial merge of only what changed would be
        // rejected the first time the document is created.
        { merge: false }
      );
      return true;
    },
    [user, role, authorName, voterId]
  );

  const clearFinalize = useCallback(
    async (targetWard: number): Promise<boolean> => {
      if (!user || !can(role, 'contactFinalize')) return false;
      await setDoc(
        doc(db, 'voterPhones', voterId),
        {
          wardNo: targetWard,
          finalPhone: '',
          finalizedBy: '',
          finalizedName: '',
          finalizedAt: null,
        },
        { merge: false }
      );
      return true;
    },
    [user, role, voterId]
  );

  const groups = useMemo(
    () => groupProposals(proposals, finalized?.finalPhone),
    [proposals, finalized?.finalPhone]
  );

  const finalPhone = finalized?.finalPhone ?? '';

  return {
    loading,
    proposals,
    finalized,
    groups,
    active: (fallback) => {
      const final = phoneKey(finalPhone);
      if (final) return final;
      return phoneKey(fallback);
    },
    finalPhone,
    canFinalize: can(role, 'contactFinalize'),
    propose,
    finalize,
    clearFinalize,
  };
}