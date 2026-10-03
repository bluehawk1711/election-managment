import { Chip } from '@/components/campaign/chip';
import { EmptyState } from '@/components/campaign/empty-state';
import { FilterBar, type FilterItem } from '@/components/campaign/filter-bar';
import { ListRow } from '@/components/campaign/list-row';
import { SearchInput } from '@/components/campaign/search-input';
import { SectionHeader } from '@/components/campaign/section-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { useColor } from '@/hooks/useColor';
import { useRoll } from '@/hooks/useRoll';
import { useAuth } from '@/providers/auth-provider';
import { can, canReadWard } from '@/lib/roles';
import { searchVoters } from '@/lib/roll/search';
import type { VoterView } from '@/lib/roll/types';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ShieldAlert, Users } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, View } from 'react-native';

type StatusFilter = 'all' | 'voted' | 'unvoted' | 'edited';

/**
 * How many rows `FlatList` renders per screenful of overscan.
 *
 * React Native mounts views lazily, so a long list only ever builds a window of
 * rows — but the default window is 21, and at ~76pt a row that is ~1,600pt of
 * mounted views for a list that may show 800. Lowering it to 5 keeps about one
 * screen ahead of the user and is the difference between smooth scrolling and
 * visible jank on a mid-range Android, which is what most karykarta run.
 *
 * `removeClippedSubviews` unmounts off-screen views on Android (a no-op on iOS,
 * which clips for free, so it is not worth branching for). `initialNumToRender`
 * sizes the first paint — set to two screens so the list is full immediately
 * rather than visibly growing. `maxToRenderPerBatch` keeps one scroll frame from
 * building a burst of work on the JS thread.
 *
 * **`getItemLayout` is deliberately absent.** It is the single biggest win
 * available here and it is unsafe on this list: `ListRow` is not a fixed height.
 * A row with a "Voted" chip or a "Pending sync" chip is taller than one with
 * neither, and a voter with no locality has no subtitle line at all. Handing
 * FlatList a constant would make scroll-to-offset and tap targeting wrong by a
 * row that grows as chips appear — worse than the measurement it skips.
 *
 * The real fix is to make `ListRow` a fixed height and give the trailing chips a
 * fixed slot; that is a component change, not a screen change, so it belongs in
 * its own commit rather than buried here.
 */
const WINDOW_SIZE = 5;

/**
 * Voter list (plan-voters.md §6.1).
 *
 * Ward selector + search across *every* field (the haystack in
 * `lib/roll/search.ts` covers name, EPIC, house, locality, age, gender,
 * serial, ward, relation, phone, leaning) + status filters.
 *
 * A karykarta only ever sees their assigned ward: the selector offers no
 * other option and `visibleWards` would drop the rows anyway.
 *
 * ## Reading the freshness flags
 *
 * `useRoll` serves the device cache first and refetches in the background, so
 * three states are normal here and none of them is an error:
 *
 * - cache hit + fetch in flight → rows render, `stale` is true, `refreshing`
 *   is true. The banner says so in one line rather than blocking on a spinner.
 * - cache miss + fetch in flight → `loading`, skeletons.
 * - cache hit + fetch failed → `connected` is false. The banner says "offline"
 *   and the list stays usable. This is the case the whole cache exists for.
 */
export default function VotersScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { profile } = useAuth();
  const outline = useColor('outline');
  const params = useLocalSearchParams<{ ward?: string }>();

  const initialWard = useMemo(() => {
    const parsed = Number(params.ward);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [params.ward]);

  const roll = useRoll(initialWard);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');

  const allWardNumbers = useMemo(
    () => (roll.wards?.wards ?? []).map((ward) => ward.wardNo),
    [roll.wards]
  );

  const allowedWards = useMemo(() => {
    const role = profile?.role ?? null;
    const scope = { wardNo: profile?.wardNo ?? null };
    return allWardNumbers.filter((wardNo) => canReadWard(role, scope, wardNo));
  }, [allWardNumbers, profile?.role, profile?.wardNo]);

  const restricted = allowedWards.length > 0 && allowedWards.length < allWardNumbers.length;

  // Scope the loaded rows for a karykarta even if the selector was bypassed.
  const scoped = useMemo(
    () =>
      restricted
        ? roll.voters.filter((voter) => allowedWards.includes(voter.wardNo))
        : roll.voters,
    [roll.voters, restricted, allowedWards]
  );

  const searched = useMemo(
    () => searchVoters(scoped, roll.index, query),
    [scoped, roll.index, query]
  );

  const filtered = useMemo(() => {
    if (status === 'all') return searched;
    if (status === 'voted') return searched.filter((voter) => voter.voted === 'voted');
    if (status === 'unvoted')
      return searched.filter((voter) => voter.voted !== 'voted');
    return searched.filter((voter) => voter.pending);
  }, [searched, status]);

  const counts = useMemo(
    () => ({
      all: searched.length,
      voted: searched.filter((voter) => voter.voted === 'voted').length,
      unvoted: searched.filter((voter) => voter.voted !== 'voted').length,
      edited: searched.filter((voter) => voter.pending).length,
    }),
    [searched]
  );

  const wardItems = useMemo<FilterItem[]>(() => {
    const meta = roll.wards?.wards ?? [];
    const items: FilterItem[] = [
      {
        key: 'all',
        label: `${t('common.all')} (${scoped.length})`,
        active: roll.wardNo === null,
      },
    ];
    for (const ward of meta) {
      if (restricted && !allowedWards.includes(ward.wardNo)) continue;
      items.push({
        key: String(ward.wardNo),
        label: `${t('voters.ward', { no: ward.wardNo })} (${ward.voterCount})`,
        active: roll.wardNo === ward.wardNo,
      });
    }
    return items;
  }, [roll.wards, roll.wardNo, scoped.length, restricted, allowedWards, t]);

  const statusItems = useMemo<FilterItem[]>(
    () =>
      (
        [
          ['all', t('common.all'), counts.all],
          ['voted', t('voters.votedYes'), counts.voted],
          ['unvoted', t('voters.votedNo'), counts.unvoted],
          ['edited', t('voters.pendingSync'), counts.edited],
        ] as [StatusFilter, string, number][]
      ).map(([key, label, count]) => ({
        key,
        label: `${label} (${count})`,
        active: status === key,
      })),
    [counts, status, t]
  );

  const loading = roll.loading;
  const emptyAll = !loading && !roll.error && scoped.length === 0;
  const emptyFiltered = !loading && scoped.length > 0 && filtered.length === 0;

  // No role is a real state, not an error: every signed-in account starts with
  // no capabilities (`lib/roles.ts`), and `firestore.rules` denies every read.
  // Rendering this as "no voters found" would tell a karykarta their ward is
  // empty, which is wrong and sends them looking for a data problem that is not
  // there.
  const noRole = !can(profile?.role ?? null, 'voterRead');

  const openWard = (wardNo: number | null) => {
    roll.setWard(wardNo);
    setQuery('');
  };

  const renderRow = ({ item }: { item: VoterView }) => (
    <ListRow
      title={item.effective.name}
      subtitle={[
        item.effective.houseNo,
        item.effective.locality,
        item.epicId,
      ]
        .filter(Boolean)
        .join(' · ')}
      meta={`${item.effective.age}`}
      onPress={() =>
        router.push({
          pathname: '/(tabs)/voters/[id]',
          params: { id: item.id, ward: String(item.wardNo) },
        })
      }
      trailing={
        <View style={styles.trailing}>
          {item.voted === 'voted' ? (
            <Chip label={t('voters.votedYes')} tone='success' />
          ) : null}
          {item.pending ? (
            <Chip label={t('voters.pendingSync')} tone='primary' />
          ) : null}
        </View>
      }
    />
  );

  return (
    <View style={styles.root}>
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={renderRow}
        keyboardShouldPersistTaps='handled'
        contentContainerStyle={styles.listContent}
        // See the constants above for why each of these is set.
        windowSize={WINDOW_SIZE}
        initialNumToRender={WINDOW_SIZE * 2}
        maxToRenderPerBatch={WINDOW_SIZE}
        updateCellsBatchingPeriod={40}
        removeClippedSubviews
        ListHeaderComponent={
          <View style={styles.header}>
            <SearchInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('voters.searchPlaceholder')}
            />
            <FilterBar items={wardItems} onToggle={(key) => openWard(key === 'all' ? null : Number(key))} />
            <FilterBar
              items={statusItems}
              onToggle={(key) => setStatus(key as StatusFilter)}
            />

            {restricted ? (
              <Text variant='caption' style={{ color: outline }}>
                {t('reports.assignedOnly', { no: allowedWards[0] ?? '' })}
              </Text>
            ) : null}

            {/* Freshness. Rendered only when there is something to say: a
                cache hit that is already up to date shows no banner at all, so
                the common case (list loaded, fresh) has zero chrome. */}
            {roll.connected === false && scoped.length > 0 ? (
              <View style={[styles.banner, { borderColor: outline }]}>
                <Text variant='caption'>{t('roll.offline')}</Text>
              </View>
            ) : roll.stale && roll.refreshing ? (
              <Text variant='caption' style={{ color: outline }}>
                {t('roll.refreshing')}
              </Text>
            ) : null}

            {noRole ? (
              <EmptyState
                icon={ShieldAlert}
                title={t('common.noRoleTitle')}
                body={t('common.noRoleBody')}
              />
            ) : roll.error ? (
              <Card style={styles.gap}>
                <Text variant='caption'>{t('voters.errorBody')}</Text>
                <Button size='sm' variant='outline' onPress={roll.retry}>
                  {t('common.retry')}
                </Button>
              </Card>
            ) : null}

            {loading && !noRole ? (
              <View style={styles.gap}>
                {[0, 1, 2, 3, 4, 5].map((row) => (
                  <Skeleton key={row} height={76} variant='rounded' />
                ))}
              </View>
            ) : emptyAll && !noRole ? (
              <EmptyState
                icon={Users}
                title={t('voters.title')}
                body={t('voters.emptyBody')}
              />
            ) : emptyFiltered && !noRole ? (
              <EmptyState
                icon={Users}
                title={t('voters.noMatches')}
                body={t('voters.noMatchesBody')}
              />
            ) : null}

            {/* Counted below the states, not above: a header reading "0 voters"
                next to an empty-state message is two things saying the same
                thing, and the message is the one worth reading. */}
            {!loading && !noRole && !roll.error && filtered.length > 0 ? (
              <SectionHeader
                title={t('voters.title')}
                hint={t('voters.count', { count: filtered.length })}
              />
            ) : null}
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  listContent: {
    padding: 20,
    paddingTop: 8,
    paddingBottom: 112,
    gap: 8,
  },
  header: { gap: 12, marginBottom: 4 },
  gap: { gap: 8 },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  banner: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 10 },
});
