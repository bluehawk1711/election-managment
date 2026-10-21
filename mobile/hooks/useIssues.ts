import { useCollection } from '@/hooks/useCollection';
import { COLLECTIONS } from '@/lib/collections';
import { issueFromDoc } from '@/lib/mappers';
import type { CivicIssue, IssueStatus } from '@/lib/models';
import { useAuth } from '@/providers/auth-provider';
import { addDoc, deleteDoc, serverTimestamp, updateDoc } from '@/lib/db';
import { useCallback } from 'react';

export type IssueCreateInput = Omit<
  CivicIssue,
  'id' | 'reportedBy' | 'reportedAt' | 'updatedAt'
>;
export type IssuePatch = Partial<Omit<CivicIssue, 'id' | 'reportedAt'>>;

/** Public/civic issue reports — live, shared across the campaign. */
export function useIssues() {
  const { user } = useAuth();

  const { docs, loading, error, connected, retry } = useCollection<CivicIssue>(
    COLLECTIONS.issues,
    issueFromDoc,
    { orderBy: { field: 'reportedAt', direction: 'desc' } }
  );

  const create = useCallback(
    async (input: IssueCreateInput) => {
      await addDoc(COLLECTIONS.issues, {
        ...input,
        reportedBy: user?.displayName || user?.email || user?.uid || 'field',
        reportedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    },
    [user]
  );

  const update = useCallback(async (id: string, patch: IssuePatch) => {
    await updateDoc(`${COLLECTIONS.issues}/${id}`, {
      ...patch,
      updatedAt: serverTimestamp(),
    });
  }, []);

  const setStatus = useCallback(
    (id: string, status: IssueStatus) =>
      updateDoc(`${COLLECTIONS.issues}/${id}`, {
        status,
        updatedAt: serverTimestamp(),
      }),
    []
  );

  const remove = useCallback(async (id: string) => {
    await deleteDoc(`${COLLECTIONS.issues}/${id}`);
  }, []);

  return { issues: docs, loading, error, connected, retry, create, update, setStatus, remove };
}
