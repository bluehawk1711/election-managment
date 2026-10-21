import { useCollection } from '@/hooks/useCollection';
import { COLLECTIONS } from '@/lib/collections';
import { eventFromDoc } from '@/lib/mappers';
import type { CampaignEvent } from '@/lib/models';
import { addDoc, deleteDoc, serverTimestamp, updateDoc } from '@/lib/db';
import { useCallback } from 'react';

export type EventCreateInput = Omit<CampaignEvent, 'id' | 'createdAt'>;
export type EventPatch = Partial<Omit<CampaignEvent, 'id' | 'createdAt'>>;

/** Campaign calendar — meetings, trainings, public events, deadlines. */
export function useEvents() {
  const { docs, loading, error, connected, retry } = useCollection<CampaignEvent>(
    COLLECTIONS.events,
    eventFromDoc,
    { orderBy: { field: 'startsAt', direction: 'asc' }, limit: 300 }
  );

  const create = useCallback(async (input: EventCreateInput) => {
    await addDoc(COLLECTIONS.events, {
      ...input,
      createdAt: serverTimestamp(),
    });
  }, []);

  const update = useCallback(async (id: string, patch: EventPatch) => {
    await updateDoc(`${COLLECTIONS.events}/${id}`, patch);
  }, []);

  const remove = useCallback(async (id: string) => {
    await deleteDoc(`${COLLECTIONS.events}/${id}`);
  }, []);

  return { events: docs, loading, error, connected, retry, create, update, remove };
}
