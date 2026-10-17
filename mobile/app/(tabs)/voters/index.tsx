import { EmptyState } from '@/components/campaign/empty-state';
import { AreaSelect } from '@/components/campaign/area-select';
import { FilterBar, type FilterItem } from '@/components/campaign/filter-bar';
import { SearchInput } from '@/components/campaign/search-input';
import { VoterCard } from '@/components/roll/voter-card';
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
import { useToast } from '@/components/ui/toast';
import { useColor } from '@/hooks/useColor';
import { Icon } from '@/components/ui/icon';
import { useRoll } from '@/hooks/useRoll';
import { useAuth } from '@/providers/auth-provider';
import { can, canReadWard } from '@/lib/roles';
import {
  SEARCH_SCOPES,
  searchVoters,
  type SearchScope,
} from '@/lib/roll/search';
import { haversineMeters, type LatLng } from '@/lib/geo';
import type { VoterView } from '@/lib/roll/types';
import { FlashList } from '@shopify/flash-list';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Phone, ShieldAlert, Users } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

type StatusFilter = 'all' | 'voted' | 'unvoted' | 'edited';

/** Age bands offered in the filter sheet. `any` is the default. */
type AgeBand = 'any' | '18-25' | '26-40' | '41-60' | '60+';

/**
 * Band → bounds and label key, in one place.
 *
 * The label keys were previously derived by a nested ternary inside a template
 * literal (`t('voters.age' + cond ? 'Young' : ...)`), which is unreadable and
 * silently mistranslates if a band is added. One row per band makes the option
 * list and its bounds impossible to drift apart.
 */
const AGE_BANDS: readonly {
  value: AgeBand;
  min: number;
  max: number;
  labelKey: 'voters.ageAny' | 'voters.ageYoung' | 'voters.ageAdult' | 'voters.ageMid' | 'voters.ageSenior';
}[] = [
  { value: 'any', min: -Infinity, max: Infinity, labelKey: 'voters.ageAny' },
  { value: '18-25', min: 18, max: 25, labelKey: 'voters.ageYoung' },
  { value: '26-40', min: 26, max: 40, labelKey: 'voters.ageAdult' },
  { value: '41-60', min: 41, max: 60, labelKey: 'voters.ageMid' },
  { value: '60+', min: 60, max: Infinity, labelKey: 'voters.ageSenior' },
];

/**
 * Whether `age` falls inside a band.
 *
 * Bounds are inclusive at both ends and the bands are contiguous, so a voter
 * at exactly 60 sits in `41-60` *and* `60+` — which is fine: each band is an
 * independent "show me people in this range" toggle, not a partition.
 */
function ageInBand(age: number, band: AgeBand): boolean {
  const row = AGE_BANDS.find((candidate) => candidate.value === band);
  if (!row) return true;
  return age >= row.min && age <= row.max;
}

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
  const toast = useToast();
  const { profile } = useAuth();
  const outline = useColor('outline');
  const params = useLocalSearchParams<{ ward?: string }>();

  const initialWard = useMemo(() => {
    const parsed = Number(params.ward);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [params.ward]);

  const roll = useRoll(initialWard);
  const [query, setQuery] = useState('');
  /**
   * Which roll area's data the list shows.
   *
   * One area ships with the app (Veernagar), so this is currently a label
   * rather than a filter — but it sits at the very top of the header because
   * it is the widest scope of the hierarchy (area > ward > voter) and the
   * place a second roll will slot in without touching the layout.
   */
  const [area, setArea] = useState('veernagar');
  const [status, setStatus] = useState<StatusFilter>('all');
  /**
   * Which fields the query is matched against.
   *
   * Starts as `name` alone: that is what a karykarta is told to say first, and
   * a broad search across ~20 fields returns the wrong Mukesh far more often
   * than it fails to return the right one. The badge row widens it deliberately
   * — father's name when asking "whose son…", locality to find a lane.
   */
  const [scopes, setScopes] = useState<SearchScope[]>(['name']);
  const [ageBand, setAgeBand] = useState<AgeBand>('any');
  /** Origin for nearest-voter mode; `null` means the feature is off. */
  const [origin, setOrigin] = useState<LatLng | null>(null);
  const [locating, setLocating] = useState(false);
  /**
   * Rows ticked for bulk actions. A long press on a card enters/toggles
   * selection (it cannot collide with navigation — `onPress` opens the sheet
   * only while this set is empty, and otherwise toggles too). Empty set =
   * normal mode; the bar above the list renders off `size`, so there is no
   * separate mode flag to get out of sync with it.
   */
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const selecting = selected.size > 0;

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
    () => searchVoters(scoped, roll.index, query, scopes),
    [scoped, roll.index, query, scopes]
  );

  /**
   * Age band, applied to the searched set before any status filtering, so the
   * counts shown on the chips and the list itself always describe the same
   * population.
   */
  const aged = useMemo(
    () =>
      ageBand === 'any'
        ? searched
        : searched.filter((voter) => ageInBand(voter.effective.age, ageBand)),
    [searched, ageBand]
  );

  /**
   * Nearest-voter ordering.
   *
   * Only voters with a recorded fix can be ordered by distance — the roll
   * itself carries no coordinates, so there is nothing to sort the rest by.
   * Rather than silently listing everyone and pretending to be ranked, mode
   * filters to the located ones and the empty state says why the list is
   * empty when there are none.
   *
   * The distance map is keyed by voter id so the render loop stays O(n) over
   * rows actually mounted, rather than recomputing per row.
   */
  const located = useMemo(() => {
    if (!origin) return null;
    const entries = scoped
      .filter((voter) => voter.location)
      .map((voter) => ({
        voter,
        meters: haversineMeters(origin, voter.location as { lat: number; lng: number }),
      }))
      .sort((a, b) => a.meters - b.meters);
    return new Map(entries.map((entry) => [entry.voter.id, entry.meters]));
  }, [scoped, origin]);

  const filtered = useMemo(() => {
    let base =
      status === 'all'
        ? aged
        : status === 'voted'
          ? aged.filter((voter) => voter.voted === 'voted')
          : status === 'unvoted'
            ? aged.filter((voter) => voter.voted !== 'voted')
            : aged.filter((voter) => voter.pending);
    if (located) base = base.filter((voter) => located.has(voter.id));
    return base.slice(0, RESULT_LIMIT);
  }, [aged, status, located]);

  /** How many matched before the render cap, for the footer line. */
  const withheld = useMemo(() => {
    const base =
      status === 'all'
        ? aged.length
        : status === 'voted'
          ? aged.filter((voter) => voter.voted === 'voted').length
          : status === 'unvoted'
            ? aged.filter((voter) => voter.voted !== 'voted').length
            : aged.filter((voter) => voter.pending).length;
    return Math.max(0, base - filtered.length);
  }, [aged, status, filtered.length]);

  const counts = useMemo(
    () => ({
      all: aged.length,
      voted: aged.filter((voter) => voter.voted === 'voted').length,
      unvoted: aged.filter((voter) => voter.voted !== 'voted').length,
      edited: aged.filter((voter) => voter.pending).length,
    }),
    [aged]
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
  /** Nearest mode is on and nothing in the current scope has a fix. */
  const emptyNearby = Boolean(located) && emptyFiltered;
  /**
   * Which of the two "nothing nearby" messages applies.
   *
   * `located.size === 0` means no voter *in the selected wards* has a fix at
   * all — the real answer is "capture locations first". A non-empty `located`
   * with an empty result means the query/age/status filter excluded them all,
   * which is a different thing to tell someone standing in a lane. Reading it
   * off `located` also avoids re-scanning every loaded row on each render.
   */
  const nearbyReason = located && located.size === 0 ? 'none' : 'scoped';

  /**
   * Scope badges — which fields the query searches.
   *
   * Tapping a badge *toggles* it in or out, so "same name, in this lane" is one
   * extra tap rather than a choice between two fixed queries. Turning the last
   * one off would leave a search box that silently matches everything, which
   * looks like the search is broken; the last active scope is kept instead.
   *
   * The row only renders while a query is typed (see the header JSX): with an
   * empty query every scope matches everything, so the badges were pure chrome
   * in the common case — and two identical-looking chip rows stacked on screen
   * is exactly what made the filter area feel confusing. Shown *while typing*,
   * directly under the input, they are also in the right place to be discovered
   * at the only moment they matter: zero results for a father's name.
   */
  const scopeItems = useMemo<FilterItem[]>(
    () =>
      SEARCH_SCOPES.map((scope) => ({
        key: scope,
        label: t(`voters.searchScope.${scope}` as const),
        active: scopes.includes(scope),
      })),
    [scopes, t]
  );

  const toggleScope = (key: string) => {
    const scope = key as SearchScope;
    setScopes((current) => {
      if (!current.includes(scope)) return [...current, scope];
      return current.length > 1 ? current.filter((item) => item !== scope) : current;
    });
  };

  /**
   * The status chips plus the nearest-mode toggle, in one filter row.
   *
   * Nearest mode is a list filter like the rest — it narrows what is shown —
   * so it lives in the chip row instead of occupying a full-width button of
   * its own. That removed ~40pt of always-visible chrome and gave it the same
   * "active = filled" affordance every other filter already speaks.
   */
  const filterItems = useMemo<FilterItem[]>(
    () => [
      ...statusItems,
      {
        key: 'nearby',
        label: locating ? t('voters.nearbyLocating') : t('voters.nearby'),
        active: Boolean(origin),
      },
    ],
    [statusItems, locating, origin, t]
  );

  const handleFilterToggle = (key: string) => {
    if (key === 'nearby') {
      // A locate can take a second or two; a second tap mid-flight would
      // start (or cancel) a race the user did not ask for.
      if (!locating) void toggleNearby();
      return;
    }
    setStatus(key as StatusFilter);
  };

  const ageOptions = useMemo<SelectOption[]>(
    () =>
      AGE_BANDS.map((band) => ({
        value: band.value,
        label: t(band.labelKey),
      })),
    [t]
  );

  /**
   * Turn nearest mode on with a fresh fix, or off if it is already on.
   *
   * A denial is reported and nothing else happens — no silent no-op, which is
   * what `captureCurrentLocation` returning null would otherwise produce.
   */
  const toggleNearby = async () => {
    if (origin) {
      setOrigin(null);
      return;
    }
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        toast.error(t('voters.nearbyDenied'));
        return;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setOrigin({ lat: position.coords.latitude, lng: position.coords.longitude });
    } catch {
      toast.error(t('voters.locationFailed'));
    } finally {
      setLocating(false);
    }
  };

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

  /** Ticks/unticks one row — the only mutation selection mode needs. */
  const toggleSelected = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /**
   * A tap opens the edit sheet directly.
   *
   * There used to be a read-only detail screen between the list and the form,
   * which meant two taps and a push/pop to change one field. The detail screen
   * has since been folded into the edit sheet — photo, location, call/WhatsApp
   * and the roll read-only rows all live there now — so routing to it as well
   * would only have been a second copy of the same screen.
   */
  const renderRow = ({ item }: { item: VoterView }) => (
    <VoterCard
      voter={item}
      meters={located?.get(item.id)}
      selected={selected.has(item.id)}
      onLongPress={() => toggleSelected(item.id)}
      onPress={() => {
        // Selection mode: a tap ticks instead of navigating, so a whole row
        // of people can be ticked with one thumb without leaving the list.
        if (selecting) {
          toggleSelected(item.id);
          return;
        }
        router.push({
          pathname: '/(tabs)/voters/edit',
          params: { id: item.id, ward: String(item.wardNo) },
        });
      }}
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
            {/* Bulk-action bar: appears the moment the first row is
                long-pressed and carries its own count + exit, so selection
                never leaves the user guessing which mode a tap is in. */}
            {selecting ? (
              <View style={styles.selectBar}>
                <Text variant='subtitle'>
                  {t('voters.selectedCount', { count: selected.size })}
                </Text>
                <View style={styles.trailing}>
                  <Button
                    size='sm'
                    icon={Phone}
                    onPress={() =>
                      router.push({
                        pathname: '/(tabs)/voters/bulk',
                        params: { ids: [...selected] },
                      })
                    }
                  >
                    {t('voters.bulkPhone')}
                  </Button>
                  <Button
                    size='sm'
                    variant='outline'
                    onPress={() => setSelected(new Set())}
                  >
                    {t('common.cancel')}
                  </Button>
                </View>
              </View>
            ) : null}
            {/* Area above search: the widest scope of the selector stack
                (area → ward → query). One 36pt pill so the header keeps the
                height the de-cluttering won back. */}
            <View style={styles.areaRow}>
              <Text variant='caption' numberOfLines={1} style={{ color: outline }}>
                {t('areas.label')}:
              </Text>
              <AreaSelect value={area} onChange={setArea} />
              <View style={styles.spacer} />
              {/* Bulk phone entry when nothing is ticked — the paste-list and
                  help modes live behind it (long-press selection feeds the
                  same screen with the ticked ids). */}
              {!selecting ? (
                <Pressable
                  onPress={() =>
                    router.push({ pathname: '/(tabs)/voters/bulk' })
                  }
                  hitSlop={8}
                  accessibilityRole='button'
                  accessibilityLabel={t('voters.bulkPhone')}
                  style={styles.bulkButton}
                >
                  <Icon name={Phone} size={16} color={outline} />
                </Pressable>
              ) : null}
            </View>
            <SearchInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('voters.searchPlaceholder')}
            />
            {/* Which fields the search covers — only while a query is typed.
                With no query every scope matches everything, so the badges
                were dead space in the default state; while typing they sit
                right under the input, which is where a user hits zero results
                for a father's name and needs to discover the widening. The
                label is inline with the chips rather than on its own line to
                keep the whole thing one 34pt row. */}
            {query.trim() ? (
              <View style={styles.scopeRow}>
                <Text
                  variant='caption'
                  numberOfLines={1}
                  style={{ color: outline }}
                >
                  {t('voters.searchIn')}:
                </Text>
                <FilterBar
                  items={scopeItems}
                  onToggle={toggleScope}
                  style={styles.scopeChips}
                />
              </View>
            ) : null}
            {/* Ward and age side by side: each was a full-width row, and two
                stacked 56pt selects is the bulk of what made this header eat
                the screen. Both keep their label *inside* the control (the
                closed state still says what it is and what it holds), so the
                row costs one line instead of two. */}
            <View style={styles.filterRow}>
              <View style={styles.half}>
                <SelectField
                  label={t('common.ward')}
                  value={selectedWard}
                  placeholder={t('form.selectWard')}
                  options={wardOptions}
                  onChange={(value) => openWard(value === ALL_WARDS ? null : Number(value))}
                  disabled={noRole || wardOptions.length <= 1}
                />
              </View>
              <View style={styles.half}>
                <SelectField
                  label={t('voters.ageFilter')}
                  value={ageBand}
                  placeholder={t('voters.ageAny')}
                  options={ageOptions}
                  onChange={(value) => setAgeBand(value as AgeBand)}
                  disabled={noRole}
                />
              </View>
            </View>
            {/* Status chips with counts, plus nearest mode as the last chip. */}
            <FilterBar items={filterItems} onToggle={handleFilterToggle} />

            {/* Nearest mode is deliberately loud when it yields nothing: the
                usual cause is that no fix has been captured yet, which the
                status-filter empty state ("clear your filters") would misread
                as a broken search. */}
            {emptyNearby ? (
              <Card style={styles.gap}>
                <Text variant='caption'>
                  {nearbyReason === 'none'
                    ? t('voters.nearbyNone')
                    : t('voters.nearbyNoneScoped')}
                </Text>
              </Card>
            ) : null}

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
            ) : emptyFiltered && !noRole && !emptyNearby ? (
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
    // 12, not 8: each VoterCard now carries a soft shadow, and shadows that
    // sit only 8pt apart visually collide into one grey smear. 12 keeps a
    // clear gutter of canvas between lifts so each card reads as its own
    // plane — the relationship-based spacing the design guide calls for.
    gap: 12,
  },
  header: { gap: 8, marginBottom: 4 },
  gap: { gap: 8 },
  /** Bulk-action bar — count on the left, actions on the right. */
  selectBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 4,
  },
  spacer: { flex: 1 },
  bulkButton: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Inline "Search in:" label + scrolling scope chips — one 34pt row. */
  scopeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  scopeChips: { flex: 1, minWidth: 0 },
  /** Area pill under its label — same inline pattern as the scope row. */
  areaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  /** Ward + age packed onto one line. */
  filterRow: { flexDirection: 'row', gap: 8 },
  half: { flex: 1, minWidth: 0 },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  banner: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 10 },
});
