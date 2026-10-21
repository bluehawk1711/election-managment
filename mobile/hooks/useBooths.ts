import { COLLECTIONS } from '@/lib/collections';
import type { Booth } from '@/lib/models';
import { addDoc, deleteDoc, updateDoc } from '@/lib/db';
import { useCallback } from 'react';

export type BoothCreateInput = Omit<Booth, 'id'>;
export type BoothPatch = Partial<Omit<Booth, 'id'>>;

/**
 * Booth writes. Reads come from `providers/reference-provider.tsx` (the whole
 * geography tree is loaded once and shared by the dashboard, filters and the
 * booth screens).
 */
export function useBooths() {
  const create = useCallback(async (input: BoothCreateInput) => {
    await addDoc(COLLECTIONS.booths, input);
  }, []);

  const update = useCallback(async (id: string, patch: BoothPatch) => {
    await updateDoc(`${COLLECTIONS.booths}/${id}`, patch);
  }, []);

  /** Put the booth's coordinator assignment in one place. */
  const assignCoordinator = useCallback(
    (boothId: string, memberId: string) =>
      updateDoc(`${COLLECTIONS.booths}/${boothId}`, { coordinatorId: memberId }),
    []
  );

  const remove = useCallback(async (id: string) => {
    await deleteDoc(`${COLLECTIONS.booths}/${id}`);
  }, []);

  return { create, update, assignCoordinator, remove };
}
