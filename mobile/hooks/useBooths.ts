import { COLLECTIONS } from '@/lib/collections';
import { db } from '@/lib/firebase';
import type { Booth } from '@/lib/models';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  updateDoc,
} from 'firebase/firestore';
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
    await addDoc(collection(db, COLLECTIONS.booths), input);
  }, []);

  const update = useCallback(async (id: string, patch: BoothPatch) => {
    await updateDoc(doc(db, COLLECTIONS.booths, id), patch);
  }, []);

  /** Put the booth's coordinator assignment in one place. */
  const assignCoordinator = useCallback(
    (boothId: string, memberId: string) =>
      updateDoc(doc(db, COLLECTIONS.booths, boothId), { coordinatorId: memberId }),
    []
  );

  const remove = useCallback(async (id: string) => {
    await deleteDoc(doc(db, COLLECTIONS.booths, id));
  }, []);

  return { create, update, assignCoordinator, remove };
}
