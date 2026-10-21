import { useCollection } from '@/hooks/useCollection';
import {
  peek as peekCache,
  save as saveCache,
  snapshotFrom,
} from '@/lib/cache/query-cache';
import { CAMPAIGN_ID, COLLECTIONS } from '@/lib/collections';
import { onDoc, serverTimestamp, setDoc } from '@/lib/db';
import { messageFor } from '@/lib/errors';
import {
  areaFromDoc,
  boothFromDoc,
  campaignFromDoc,
  constituencyFromDoc,
  teamMemberFromDoc,
  wardFromDoc,
} from '@/lib/mappers';
import type { Area, Booth, Campaign, Constituency, TeamMember, Ward } from '@/lib/models';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/** `campaigns/active` — the one document this prototype talks about. */
const CAMPAIGN_PATH = `${COLLECTIONS.campaigns}/${CAMPAIGN_ID}`;

interface ReferenceContextType {
  campaign: Campaign | null;
  constituencies: Constituency[];
  wards: Ward[];
  areas: Area[];
  booths: Booth[];
  team: TeamMember[];

  loading: boolean;
  error: string | null;
  connected: boolean;
  retry: () => void;

  areaById: (id: string) => Area | undefined;
  wardById: (id: string) => Ward | undefined;
  boothById: (id: string) => Booth | undefined;
  memberById: (id: string) => TeamMember | undefined;

  areaName: (id: string) => string;
  wardName: (id: string) => string;
  boothLabel: (id: string) => string;
  memberName: (id: string) => string;
  /** 'Ward 4 · Ratanada' style line for any area/booth/task id. */
  areaContext: (areaId: string) => string;

  updateCampaign: (patch: Partial<Omit<Campaign, 'id'>>) => Promise<void>;
  /** Staffed booths / total booths, per ward — the dashboard rails. */
  wardCoverage: { wardId: string; label: string; ratio: number }[];
  boothsWithoutCoordinator: Booth[];
}

const ReferenceContext = createContext<ReferenceContextType | null>(null);

/** Cache key for the single campaign document; also in `PREWARM_KEYS`. */
const CAMPAIGN_CACHE_KEY = `${COLLECTIONS.campaigns}:${CAMPAIGN_ID}`;

/**
 * The campaign's shared reference data, loaded once for the session:
 * campaign profile, the constituency → ward → area geography, the booth list
 * and the team roster. Every screen reads from here instead of opening five
 * listeners of its own.
 *
 * Everything here is served cache-first via `lib/cache/query-cache` — the
 * collections through `useCollection`, and the campaign document through the
 * same store seeded in the state initialiser. Reference data changes a few
 * times a season, so re-reading it from the network on every cold start costs
 * six `Listen` streams and a screen of skeletons to display data the device
 * already had.
 */
export function ReferenceProvider({ children }: { children: ReactNode }) {
  // Seeded synchronously from the cache: the app renders the previous
  // campaign's details on the first frame rather than an empty header, and the
  // subscription below quietly replaces them.
  const [campaign, setCampaign] = useState<Campaign | null>(() => {
    const cached = peekCache(CAMPAIGN_CACHE_KEY);
    if (!cached || cached.docs.length === 0) return null;
    return campaignFromDoc(snapshotFrom(cached.docs[0]));
  });
  const [campaignLoaded, setCampaignLoaded] = useState(() => campaign !== null);
  const [campaignError, setCampaignError] = useState<string | null>(null);

  useEffect(
    () =>
      onDoc(
        CAMPAIGN_PATH,
        (snapshot) => {
          setCampaign(campaignFromDoc(snapshot));
          setCampaignError(null);
          setCampaignLoaded(true);
          // `metadata.fromCache` is `.info/connected` at delivery time — see
          // `lib/db`. Cached rows must not re-stamp `savedAt`.
          if (snapshot.exists() && !snapshot.metadata.fromCache) {
            saveCache(CAMPAIGN_CACHE_KEY, [
              { id: snapshot.id, data: snapshot.data() },
            ]);
          }
        },
        (caught) => {
          // As in `useCollection`: an error here must not blank the campaign
          // details the cache already supplied. `campaignLoaded` still flips so
          // the provider stops reporting `loading`.
          setCampaignError(messageFor(caught));
          setCampaignLoaded(true);
        }
      ),
    []
  );

  const constituencies = useCollection<Constituency>(
    COLLECTIONS.constituencies,
    constituencyFromDoc,
    { orderBy: { field: 'name' } }
  );
  const wards = useCollection<Ward>(COLLECTIONS.wards, wardFromDoc, {
    orderBy: { field: 'name' },
  });
  const areas = useCollection<Area>(COLLECTIONS.areas, areaFromDoc, {
    orderBy: { field: 'name' },
  });
  const booths = useCollection<Booth>(COLLECTIONS.booths, boothFromDoc, {
    orderBy: { field: 'number' },
  });
  const team = useCollection<TeamMember>(COLLECTIONS.teamMembers, teamMemberFromDoc, {
    orderBy: { field: 'name' },
  });

  const { docs: constituencyDocs } = constituencies;
  const { docs: wardDocs } = wards;
  const { docs: areaDocs } = areas;
  const { docs: boothDocs } = booths;
  const { docs: teamDocs } = team;

  const areaById = useMemo(
    () => new Map(areaDocs.map((item) => [item.id, item])),
    [areaDocs]
  );
  const wardById = useMemo(() => new Map(wardDocs.map((item) => [item.id, item])), [wardDocs]);
  const boothById = useMemo(
    () => new Map(boothDocs.map((item) => [item.id, item])),
    [boothDocs]
  );
  const memberById = useMemo(() => new Map(teamDocs.map((item) => [item.id, item])), [teamDocs]);

  const loading =
    !campaignLoaded ||
    constituencies.loading ||
    wards.loading ||
    areas.loading ||
    booths.loading ||
    team.loading;

  const error =
    campaignError ??
    constituencies.error ??
    wards.error ??
    areas.error ??
    booths.error ??
    team.error;

  const connected =
    constituencies.connected && wards.connected && areas.connected && booths.connected;

  const retry = useCallback(() => {
    setCampaignError(null);
    constituencies.retry();
    wards.retry();
    areas.retry();
    booths.retry();
    team.retry();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    constituencies.retry,
    wards.retry,
    areas.retry,
    booths.retry,
    team.retry,
  ]);

  const updateCampaign = useCallback(
    async (patch: Partial<Omit<Campaign, 'id'>>) => {
      // A merge write, NOT a full overwrite: on a project where
      // `campaigns/active` has never been written — which was the live state
      // of this one — a non-merge update fails outright ("no node to update")
      // and the election-day picker could never save the date it was created
      // to set. Merge writes the patch when the node exists and CREATES it when
      // it does not, and either way only these keys are affected, which is what
      // the rules' delta check validates.
      await setDoc(
        CAMPAIGN_PATH,
        { ...patch, updatedAt: serverTimestamp() },
        { merge: true }
      );
    },
    []
  );

  const wardCoverage = useMemo(() => {
    return wardDocs.map((ward) => {
      const wardBooths = boothDocs.filter((booth) => booth.wardId === ward.id);
      const staffed = wardBooths.filter((booth) => booth.coordinatorId).length;
      return {
        wardId: ward.id,
        label: ward.name,
        ratio: wardBooths.length ? staffed / wardBooths.length : 0,
      };
    });
  }, [wardDocs, boothDocs]);

  const boothsWithoutCoordinator = useMemo(
    () => boothDocs.filter((booth) => !booth.coordinatorId),
    [boothDocs]
  );

  const value = useMemo<ReferenceContextType>(
    () => ({
      campaign,
      constituencies: constituencyDocs,
      wards: wardDocs,
      areas: areaDocs,
      booths: boothDocs,
      team: teamDocs,
      loading,
      error,
      connected,
      retry,

      areaById: (id) => areaById.get(id),
      wardById: (id) => wardById.get(id),
      boothById: (id) => boothById.get(id),
      memberById: (id) => memberById.get(id),

      areaName: (id) => areaById.get(id)?.name ?? '',
      wardName: (id) => wardById.get(id)?.name ?? '',
      boothLabel: (id) => {
        const booth = boothById.get(id);
        return booth ? `Booth ${booth.number}` : '';
      },
      memberName: (id) => memberById.get(id)?.name ?? '',
      areaContext: (areaId) => {
        const area = areaById.get(areaId);
        if (!area) return '';
        const ward = wardById.get(area.wardId);
        return ward ? `${area.name} · ${ward.name}` : area.name;
      },

      updateCampaign,
      wardCoverage,
      boothsWithoutCoordinator,
    }),
    [
      campaign,
      constituencyDocs,
      wardDocs,
      areaDocs,
      boothDocs,
      teamDocs,
      loading,
      error,
      connected,
      retry,
      areaById,
      wardById,
      boothById,
      memberById,
      updateCampaign,
      wardCoverage,
      boothsWithoutCoordinator,
    ]
  );

  return (
    <ReferenceContext.Provider value={value}>{children}</ReferenceContext.Provider>
  );
}

export function useReference(): ReferenceContextType {
  const context = useContext(ReferenceContext);
  if (!context) {
    throw new Error('useReference must be used within a ReferenceProvider');
  }
  return context;
}
