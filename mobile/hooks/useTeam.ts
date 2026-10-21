import { COLLECTIONS } from '@/lib/collections';
import { addDoc, deleteDoc, updateDoc } from '@/lib/db';
import type { TeamMember } from '@/lib/models';
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
    await addDoc(COLLECTIONS.teamMembers, input);
  }, []);

  const update = useCallback(async (id: string, patch: TeamPatch) => {
    await updateDoc(`${COLLECTIONS.teamMembers}/${id}`, patch);
  }, []);

  const remove = useCallback(async (id: string) => {
    await deleteDoc(`${COLLECTIONS.teamMembers}/${id}`);
  }, []);

  return { create, update, remove };
}
