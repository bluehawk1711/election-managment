import { useCollection } from '@/hooks/useCollection';
import { COLLECTIONS } from '@/lib/collections';
import { db } from '@/lib/firebase';
import { complianceFromDoc } from '@/lib/mappers';
import type { ComplianceItem, ComplianceStatus } from '@/lib/models';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { useCallback } from 'react';

export type ComplianceCreateInput = Omit<ComplianceItem, 'id' | 'updatedAt'>;
export type CompliancePatch = Partial<Omit<ComplianceItem, 'id'>>;

/** Compliance checklist — permissions, expense documentation, deadlines. */
export function useCompliance() {
  const { docs, loading, error, connected, retry } = useCollection<ComplianceItem>(
    COLLECTIONS.compliance,
    complianceFromDoc,
    { orderBy: { field: 'dueDate', direction: 'asc' }, limit: 200 }
  );

  const create = useCallback(async (input: ComplianceCreateInput) => {
    await addDoc(collection(db, COLLECTIONS.compliance), {
      ...input,
      updatedAt: serverTimestamp(),
    });
  }, []);

  const update = useCallback(async (id: string, patch: CompliancePatch) => {
    await updateDoc(doc(db, COLLECTIONS.compliance, id), {
      ...patch,
      updatedAt: serverTimestamp(),
    });
  }, []);

  const setStatus = useCallback(
    (id: string, status: ComplianceStatus) =>
      updateDoc(doc(db, COLLECTIONS.compliance, id), {
        status,
        updatedAt: serverTimestamp(),
      }),
    []
  );

  const remove = useCallback(async (id: string) => {
    await deleteDoc(doc(db, COLLECTIONS.compliance, id));
  }, []);

  return {
    items: docs,
    loading,
    error,
    connected,
    retry,
    create,
    update,
    setStatus,
    remove,
  };
}
