import {
  clearBulkSelection,
  getBulkSelection,
  subscribeBulkSelection,
  toggleBulkSelection,
} from '@/lib/roll/bulk-selection';
import { useEffect, useState } from 'react';

/**
 * The ticked-for-bulk voter ids, live on every screen that shows them.
 *
 * The list writes (`toggle`), the bulk screen reads (`ids`) — through the
 * same module store (`lib/roll/bulk-selection.ts`), so the selection does
 * not travel through route params and cannot be lost to the serialiser
 * (expo-router flattens an array param to one comma-joined string, which
 * is why the bulk screen used to open empty with nothing ticked).
 *
 * - `ids`      — the ticked ids, in tick order.
 * - `toggle`   — ticks/unticks one row.
 * - `clear`    — empties the selection (cancel, or once the bulk work is
 *                done and the ticks would only be a trap for the next tap).
 *
 * Unsubscribing on unmount and seeding from `getBulkSelection()` keeps a
 * remount (modal dismissal, fast refresh) on the same set rather than
 * flashing an empty one.
 */
export function useBulkSelection(): {
  ids: ReadonlySet<string>;
  toggle: (id: string) => void;
  clear: () => void;
} {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => getBulkSelection());

  useEffect(() => subscribeBulkSelection(setIds), []);

  return { ids, toggle: toggleBulkSelection, clear: clearBulkSelection };
}
