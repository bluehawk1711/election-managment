import { useCollection } from '@/hooks/useCollection';
import { COLLECTIONS } from '@/lib/collections';
import { db } from '@/lib/firebase';
import { voterFromDoc } from '@/lib/mappers';
import type { Voter } from '@/lib/models';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  updateDoc,
} from 'firebase/firestore';
import { useCallback } from 'react';

export interface VoterScope {
  /** Equality scope — one of these keeps the query index-free. */
  boothId?: string | null;
  areaId?: string | null;
  /** Voters are the biggest collection; scope or cap before listing. */
  limit?: number;
}

export type VoterCreateInput = Omit<Voter, 'id'>;
export type VoterPatch = Partial<Omit<Voter, 'id'>>;

/**
 * Voter roll reader/writer.
 *
 * No `orderBy` here on purpose: Firestore drops documents missing an ordered
 * field and would demand a composite index the moment a `where` joins it.
 * Sorting happens in `filterVoters()` on the client.
 */
export function useVoters(scope: VoterScope = {}) {
  const whereFilter = scope.boothId
    ? { field: 'boothId', value: scope.boothId }
    : scope.areaId
      ? { field: 'areaId', value: scope.areaId }
      : null;

  const { docs, loading, error, connected, retry } = useCollection<Voter>(
    COLLECTIONS.voters,
    voterFromDoc,
    { where: whereFilter, limit: scope.limit ?? 1000 }
  );

  const create = useCallback(async (input: VoterCreateInput) => {
    await addDoc(collection(db, COLLECTIONS.voters), input);
  }, []);

  const update = useCallback(async (id: string, patch: VoterPatch) => {
    await updateDoc(doc(db, COLLECTIONS.voters, id), patch);
  }, []);

  const remove = useCallback(async (id: string) => {
    await deleteDoc(doc(db, COLLECTIONS.voters, id));
  }, []);

  return { voters: docs, loading, error, connected, retry, create, update, remove };
}
