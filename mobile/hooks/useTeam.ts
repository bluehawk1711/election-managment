import { COLLECTIONS } from '@/lib/collections';
import { db } from '@/lib/firebase';
import type { TeamMember } from '@/lib/models';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  updateDoc,
} from 'firebase/firestore';
import { useCallback } from 'react';

export type TeamCreateInput = Omit<TeamMember, 'id'>;
export type TeamPatch = Partial<Omit<TeamMember, 'id'>>;

/**
 * Team mutations. Reads live in `providers/reference-provider.tsx` — the
 * roster is small, needed by every screen (assignee chips, coordinator
 * badges), so it is loaded once for the whole session instead of once per
 * screen.
 */
export function useTeam() {
  const create = useCallback(async (input: TeamCreateInput) => {
    await addDoc(collection(db, COLLECTIONS.teamMembers), input);
  }, []);

  const update = useCallback(async (id: string, patch: TeamPatch) => {
    await updateDoc(doc(db, COLLECTIONS.teamMembers, id), patch);
  }, []);

  const remove = useCallback(async (id: string) => {
    await deleteDoc(doc(db, COLLECTIONS.teamMembers, id));
  }, []);

  return { create, update, remove };
}
