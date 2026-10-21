import { useCollection } from '@/hooks/useCollection';
import { COLLECTIONS } from '@/lib/collections';
import { complianceFromDoc } from '@/lib/mappers';
import type { ComplianceItem, ComplianceStatus } from '@/lib/models';
import { addDoc, deleteDoc, serverTimestamp, updateDoc } from '@/lib/db';
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
    await addDoc(COLLECTIONS.compliance, {
      ...input,
      updatedAt: serverTimestamp(),
    });
  }, []);

  const update = useCallback(async (id: string, patch: CompliancePatch) => {
    await updateDoc(`${COLLECTIONS.compliance}/${id}`, {
      ...patch,
      updatedAt: serverTimestamp(),
    });
  }, []);

  const setStatus = useCallback(
    (id: string, status: ComplianceStatus) =>
      updateDoc(`${COLLECTIONS.compliance}/${id}`, {
        status,
        updatedAt: serverTimestamp(),
      }),
    []
  );

  const remove = useCallback(async (id: string) => {
    await deleteDoc(`${COLLECTIONS.compliance}/${id}`);
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
