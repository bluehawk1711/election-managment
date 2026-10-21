import { COLLECTIONS } from '@/lib/collections';
import { messageFor } from '@/lib/errors';
import { taskFromDoc } from '@/lib/mappers';
import type { Task, TaskStatus } from '@/lib/models';
import { useCollection } from '@/hooks/useCollection';
import { useAuth } from '@/providers/auth-provider';
import { addDoc, deleteDoc, serverTimestamp, updateDoc } from '@/lib/db';
import { useCallback } from 'react';

export type TaskCreateInput = Omit<Task, 'id' | 'createdBy' | 'createdAt' | 'updatedAt'>;
export type TaskPatch = Partial<Omit<Task, 'id' | 'createdAt'>>;

/**
 * Shared campaign tasks — create / transition / edit / delete, live.
 *
 * Writes throw; screens run them through `useAction()` so failures surface as
 * a translated toast instead of dying silently (RTDB only rejects on the
 * awaited promise, never on the listener).
 */
export function useTasks() {
  const { user } = useAuth();

  const { docs, loading, error, connected, retry } = useCollection<Task>(
    COLLECTIONS.tasks,
    taskFromDoc,
    { orderBy: { field: 'createdAt', direction: 'desc' } }
  );

  const create = useCallback(
    async (input: TaskCreateInput) => {
      await addDoc(COLLECTIONS.tasks, {
        ...input,
        createdBy: user?.uid ?? '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    },
    [user]
  );

  const update = useCallback(async (id: string, patch: TaskPatch) => {
    await updateDoc(`${COLLECTIONS.tasks}/${id}`, {
      ...patch,
      updatedAt: serverTimestamp(),
    });
  }, []);

  const setStatus = useCallback(
    (id: string, status: TaskStatus) => updateDoc(`${COLLECTIONS.tasks}/${id}`, {
      status,
      updatedAt: serverTimestamp(),
    }),
    []
  );

  const remove = useCallback(async (id: string) => {
    await deleteDoc(`${COLLECTIONS.tasks}/${id}`);
  }, []);

  return {
    tasks: docs,
    loading,
    error,
    connected,
    retry,
    create,
    update,
    setStatus,
    remove,
    /** Re-export so screens never import messageFor twice. */
    messageFor,
  };
}
