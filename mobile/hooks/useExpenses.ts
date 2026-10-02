import { useCollection } from '@/hooks/useCollection';
import { COLLECTIONS } from '@/lib/collections';
import { db } from '@/lib/firebase';
import { expenseFromDoc } from '@/lib/mappers';
import type { Expense, ExpenseStatus } from '@/lib/models';
import { useAuth } from '@/providers/auth-provider';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { useCallback } from 'react';

export type ExpenseCreateInput = Omit<
  Expense,
  'id' | 'createdBy' | 'createdAt' | 'status'
> & { status?: ExpenseStatus };
export type ExpensePatch = Partial<Omit<Expense, 'id' | 'createdAt'>>;

/** Campaign expense tracker — date, category, amount, receipt, approval. */
export function useExpenses() {
  const { user } = useAuth();

  const { docs, loading, error, connected, retry } = useCollection<Expense>(
    COLLECTIONS.expenses,
    expenseFromDoc,
    { orderBy: { field: 'date', direction: 'desc' } }
  );

  const create = useCallback(
    async (input: ExpenseCreateInput) => {
      const { status = 'pending', ...rest } = input;
      await addDoc(collection(db, COLLECTIONS.expenses), {
        ...rest,
        status,
        createdBy: user?.uid ?? '',
        createdAt: serverTimestamp(),
      });
    },
    [user]
  );

  const update = useCallback(async (id: string, patch: ExpensePatch) => {
    await updateDoc(doc(db, COLLECTIONS.expenses, id), patch);
  }, []);

  const setStatus = useCallback(
    (id: string, status: ExpenseStatus) =>
      updateDoc(doc(db, COLLECTIONS.expenses, id), { status }),
    []
  );

  const remove = useCallback(async (id: string) => {
    await deleteDoc(doc(db, COLLECTIONS.expenses, id));
  }, []);

  return { expenses: docs, loading, error, connected, retry, create, update, setStatus, remove };
}
