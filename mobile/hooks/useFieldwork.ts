/**
 * `useFieldwork` — the account's edit counters for the dashboard.
 *
 * Reads every ward overlay out of AsyncStorage (13 small keys; the ward open
 * in the roll is already cached in memory by `overlay.ts`, so the cold cost
 * is ~12 JSON parses of a few KB) and the roll's total from the bundled
 * wards bundle for the denominator.
 *
 * Re-runs on `subscribeOverlay` — a save in the edit sheet refreshes these
 * numbers wherever the subscriber lives. It also kicks a `syncVoterEdits()`
 * on mount, because the dashboard is where a user checks "did my work land?"
 * from a second device: the numbers must be the account's, not this
 * device's, which means pulling before counting.
 */
import { bundledWards } from '@/lib/roll/bundled';
import { editRatio, fieldworkStats, type FieldworkStats } from '@/lib/roll/fieldwork';
import {
  loadQueue,
  loadWardOverlay,
  overlayStorage,
  subscribeOverlay,
} from '@/lib/roll/overlay';
import { syncVoterEdits } from '@/lib/roll/sync';
import type { VoterOverlay } from '@/lib/roll/types';
import { useEffect, useMemo, useState } from 'react';

export interface FieldworkState {
  stats: FieldworkStats;
  /** 0–1 coverage of edited voters over the whole roll. */
  ratio: number;
  /** Edits still queued for push — the number behind the pending badge. */
  queued: number;
  /** False until the first overlay read lands — a skeleton, not an error. */
  loading: boolean;
}

const EMPTY: FieldworkStats = {
  edited: 0,
  phones: 0,
  photos: 0,
  locations: 0,
  voted: 0,
  totalVoters: 0,
};

/**
 * Ward overlay keys the store maintains, mirroring `wards-summary.csv`
 * (13 wards). A constant rather than derived from `bundledWards()` because
 * the overlays must be readable *while* the bundle load is in flight —
 * deriving it would gate local data on an asset read for no reason.
 */
const WARD_COUNT = 13;

export function useFieldwork(): FieldworkState {
  const [overlays, setOverlays] = useState<Record<string, VoterOverlay>[]>([]);
  const [total, setTotal] = useState(0);
  const [queued, setQueued] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const wards = await Promise.all(
          Array.from({ length: WARD_COUNT }, (_, index) =>
            loadWardOverlay(overlayStorage, index + 1)
          )
        );
        const [bundle, queue] = await Promise.all([
          Promise.resolve(bundledWards()),
          loadQueue(overlayStorage),
        ]);
        if (cancelled) return;
        setOverlays(wards);
        setTotal(bundle?.total ?? 0);
        setQueued(queue.length);
        setLoading(false);
      } catch {
        // A missing/unreadable bundle must not blank the dashboard: the
        // counters still reflect local work (total shows 0 → the card hides
        // its percentage via ratio 0), and the next overlay event reloads.
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    void syncVoterEdits().catch(() => undefined);

    const stop = subscribeOverlay(() => {
      void load();
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  return useMemo(() => {
    const stats = overlays.length ? fieldworkStats(overlays, total) : EMPTY;
    return { stats, ratio: editRatio(stats), queued, loading };
  }, [overlays, total, queued, loading]);
}