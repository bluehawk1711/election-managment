/**
 * The voter ids ticked for bulk actions — one source of truth shared by the
 * list screen (which writes it) and the bulk screen (which reads it).
 *
 * ## Why this exists instead of route params
 *
 * The selection used to travel as `router.push({ params: { ids: [...] } })`,
 * and expo-router serialises an array param with `value.toString()` — i.e.
 * a single comma-joined string. `useLocalSearchParams` hands that string
 * back as ONE value, so the bulk screen's `Array.isArray` branch never ran,
 * `byId.get('id1,id2,id3')` matched nothing, `ticked` came back empty and
 * the reader landed on the "nothing selected" screen with no voter rows at
 * all — the selection silently vanished in transit.
 *
 * A module store sidesteps serialization entirely: the ids never leave JS
 * memory, so there is no encode/decode step to get wrong, no URL-length
 * ceiling when forty rows are ticked, and no "which of the two sources is
 * newer" question when the screen remounts. It also means the bulk screen
 * and the list share live state — see `useBulkSelection`.
 *
 * Same shape as `lib/whatsapp-message.ts` (cache + listener set), which is
 * the house pattern for app-wide state the React tree merely observes;
 * there is no zustand/redux in this project and adding one for a single
 * string set would be more machinery than the problem.
 */
// A plain TS set type — `ReadonlySet` is a lib DOM/ES builtin, no import
// needed (and `from 'react'` would not be a thing).

let selected: ReadonlySet<string> = new Set();

type Listener = (ids: ReadonlySet<string>) => void;
const listeners = new Set<Listener>();

const emit = () => {
  for (const listener of listeners) listener(selected);
};

/** The currently ticked ids. */
export function getBulkSelection(): ReadonlySet<string> {
  return selected;
}

/** Replaces the selection wholesale (cancel, clear-after-save). */
export function setBulkSelection(ids: ReadonlySet<string>): void {
  selected = ids;
  emit();
}

/** Ticks/unticks one row — the only mutation selection mode needs. */
export function toggleBulkSelection(id: string): void {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected = next;
  emit();
}

/** Empties the selection — used when the work it existed for is done. */
export function clearBulkSelection(): void {
  if (selected.size === 0) return;
  selected = new Set();
  emit();
}

/** Fires on every change. Returns unsubscribe. */
export function subscribeBulkSelection(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
