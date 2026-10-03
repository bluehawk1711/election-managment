import { Chip } from '@/components/campaign/chip';
import { EmptyState } from '@/components/campaign/empty-state';
import { FilterBar, type FilterItem } from '@/components/campaign/filter-bar';
import { ListRow } from '@/components/campaign/list-row';
import { SearchInput } from '@/components/campaign/search-input';
import { SectionHeader } from '@/components/campaign/section-header';
import {
  SelectField,
  type SelectOption,
} from '@/components/campaign/select-field';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Text } from '@/components/ui/text';
import { useColor } from '@/hooks/useColor';
import { useRoll } from '@/hooks/useRoll';
import { useAuth } from '@/providers/auth-provider';
import { can, canReadWard } from '@/lib/roles';
import { searchVoters } from '@/lib/roll/search';
import type { VoterView } from '@/lib/roll/types';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ShieldAlert, Users } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

type StatusFilter = 'all' | 'voted' | 'unvoted' | 'edited';

/**
 * Sentinel for the ward select's "every ward" option.
 *
 * A string rather than `''` because `SelectField` matches options on `value`
 * and an empty string would read as "nothing selected" rather than a real
 * choice. `0` is not usable either — ward numbers start at 1.
 */
const ALL_WARDS = 'all';

/**
 * Search results are capped for rendering only.
 *
 * Not pagination: the ward data is already resident (paged in by `useRoll`), so
 * filtering it is pure CPU. What *is* expensive is mounting tens of thousands
 * of rows — and because a phonetic key matches loosely by design, a broad query
 * can legitimately return a very large set. Rather than truncate silently,
 * the screen renders the first `RESULT_LIMIT` and says how many were withheld,
 * which is honest: a karykarta needs to know the list is showing 500 of 3,000.
 */
const RESULT_LIMIT = 300;

/**
 * Voter list (plan-voters.md §6.1).
 *
 * Ward selector + search across *every* field (the haystack in
 * `lib/roll/search.ts` covers name, EPIC, house, locality, age, gender,
 * serial, ward, relation, phone, leaning) + status filters. Search works from
 * a Devanagari keyboard and a Latin one alike — see `lib/roll/translit.ts`.
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
 *
 * ## Why FlashList, and why there are no tuning props
 *
 * This used to be a `FlatList` carrying a pile of hand-tuned numbers
 * (`windowSize`, `maxToRenderPerBatch`, `updateCellsBatchingPeriod`,
 * `removeClippedSubviews`, plus a comment explaining why `getItemLayout` was
 * deliberately unsafe). That was a reasonable attempt to make a virtualised list
 * behave on a mid-range Android, and most of it is now the library's job:
 * FlashList recycles cell *views* natively instead of re-running `renderItem`
 * for every row on scroll, which is where the jank actually came from.
 *
 * The props are gone because they are either handled internally or actively
 * harmful. `getItemLayout` in particular must stay absent unless every row is a
 * fixed height, and `ListRow` is not one: a row with a "Voted" chip is taller
 * than one without, and a voter with no locality has no subtitle line at all. A
 * constant would make scroll targeting wrong by a row that grows as chips
 * appear.
 *
 * Real scrolling cost is instead bounded by how much the list is asked to
 * render, which is `RESULT_LIMIT` above.
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
  //
  // A `Set`, not `Array.includes`: this runs over every loaded row (thousands)
  // and re-runs on each new batch, and a linear scan per row turned that into
  // tens of thousands of comparisons on the JS thread — the sort of thing that
  // shows up as a stutter when the user reaches the end of the list.
  const scoped = useMemo(() => {
    if (!restricted) return roll.voters;
    const allowed = new Set(allowedWards);
    return roll.voters.filter((voter) => allowed.has(voter.wardNo));
  }, [roll.voters, restricted, allowedWards]);

  const searched = useMemo(
    () => searchVoters(scoped, roll.index, query),
    [scoped, roll.index, query]
  );

  const filtered = useMemo(() => {
    const base =
      status === 'all'
        ? searched
        : status === 'voted'
          ? searched.filter((voter) => voter.voted === 'voted')
          : status === 'unvoted'
            ? searched.filter((voter) => voter.voted !== 'voted')
            : searched.filter((voter) => voter.pending);
    return base.slice(0, RESULT_LIMIT);
  }, [searched, status]);

  /** How many matched before the render cap, for the footer line. */
  const withheld = useMemo(() => {
    const base =
      status === 'all'
        ? searched.length
        : status === 'voted'
          ? searched.filter((voter) => voter.voted === 'voted').length
          : status === 'unvoted'
            ? searched.filter((voter) => voter.voted !== 'voted').length
            : searched.filter((voter) => voter.pending).length;
    return Math.max(0, base - filtered.length);
  }, [searched, status, filtered.length]);

  const counts = useMemo(
    () => ({
      all: searched.length,
      voted: searched.filter((voter) => voter.voted === 'voted').length,
      unvoted: searched.filter((voter) => voter.voted !== 'voted').length,
      edited: searched.filter((voter) => voter.pending).length,
    }),
    [searched]
  );

  // The ward filter is a select rather than a row of chips. Thirteen wards plus
  // "All" is fourteen targets in a horizontal scroller, which on a small phone
  // pushes the currently-selected ward off-screen — the user could not see what
  // they had filtered to without scrolling back. A select shows the current
  // value in the closed state, so the answer is always visible.
  const wardOptions = useMemo<SelectOption[]>(() => {
    const meta = roll.wards?.wards ?? [];
    const options: SelectOption[] = [
      { value: ALL_WARDS, label: `${t('common.all')} (${scoped.length})` },
    ];
    for (const ward of meta) {
      if (restricted && !allowedWards.includes(ward.wardNo)) continue;
      // Ward *name*, not just the number. `delimitation` is the area the ward
      // covers, taken from the roll itself ("पार्श्चनाथ सिटी, जेपीनगर … का
      // क्षेत्र"). A karykarta identifies a ward by where it is, not by an
      // ordinal, and it is the same string on the voter's ID card.
      //
      // Second line, not inline: the delimitation strings are long enough that
      // appending them to the label pushed the ward number off the row.
      options.push({
        value: String(ward.wardNo),
        label: `${t('voters.ward', { no: ward.wardNo })} (${ward.voterCount})`,
        hint: ward.delimitation,
      });
    }
    return options;
  }, [roll.wards, scoped.length, restricted, allowedWards, t]);

  const selectedWard = roll.wardNo == null ? ALL_WARDS : String(roll.wardNo);

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
        item.voted === 'voted' ? (
          <Chip label={t('voters.votedYes')} tone='success' />
        ) : null
      }
    />
  );

  return (
    <View style={styles.root}>
      <FlashList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={renderRow}
        keyboardShouldPersistTaps='handled'
        contentContainerStyle={styles.listContent}
        // Progressive loading. `useRoll` pages the "all wards" selection in
        // batches of three wards; reaching the end asks for the next one
        // instead of having paid for all 6,855 rows on open.
        onEndReached={roll.hasMore ? roll.loadMore : undefined}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          <View style={styles.footer}>
            {roll.loadingMore ? <Spinner size='sm' variant='circle' /> : null}
            {withheld > 0 ? (
              <Text variant='caption' style={{ color: outline }}>
                {t('voters.moreResults', {
                  shown: filtered.length,
                  total: filtered.length + withheld,
                })}
              </Text>
            ) : null}
          </View>
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <SearchInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('voters.searchPlaceholder')}
            />
            <SelectField
              label={t('common.ward')}
              value={selectedWard}
              placeholder={t('form.selectWard')}
              options={wardOptions}
              onChange={(value) => openWard(value === ALL_WARDS ? null : Number(value))}
              disabled={noRole || wardOptions.length <= 1}
            />
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
  footer: { alignItems: 'center', gap: 8, paddingVertical: 20 },
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
