import { Chip } from '@/components/campaign/chip';
import { EmptyState } from '@/components/campaign/empty-state';
import { ProgressRail } from '@/components/campaign/progress-rail';
import { SectionHeader } from '@/components/campaign/section-header';
import { Card } from '@/components/ui/card';
import { ScrollView } from '@/components/ui/scroll-view';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { useColor } from '@/hooks/useColor';
import { useRoll } from '@/hooks/useRoll';
import { can, canReadWard } from '@/lib/roles';
import type { VoterView, WardsBundle } from '@/lib/roll/types';
import { useAuth } from '@/providers/auth-provider';
import { useRouter } from 'expo-router';
import { BarChart3, ShieldAlert } from 'lucide-react-native';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

interface WardReport {
  wardNo: number;
  boothNo: number;
  roomNo: number;
  boothAddress: string;
  delimitation: string;
  total: number;
  male: number;
  female: number;
  third: number;
  voted: number;
  photos: number;
  edited: number;
}

/**
 * Booth report (plan-voters.md §6.4).
 *
 * Everything is derived locally: ward totals come from the roll bundle, the
 * voted/photo/edit counts from this device's overlay. That is the honest
 * number while sync is off — the screen shows this device's progress rather
 * than implying a campaign-wide tally it cannot compute.
 *
 * The screen is scrollable and leads with data that exists before anyone has
 * marked a single voter — gender split, booth address and room, the area the
 * ward covers. The field counters (turnout, photos, pending) sit on top of
 * that rather than being the whole page, so the report is never a wall of
 * zeros on a fresh install.
 *
 * A karykarta sees only their assigned booth; admin and above see all 13.
 */
export default function ReportsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { profile } = useAuth();
  const outline = useColor('outline');

  // `eager: true` on purpose. This screen tallies voted / photos / edits across
  // *every* ward, so it cannot page: a partial set of wards would report
  // confident, wrong numbers. Being honest about that beats being fast on the
  // one screen whose whole job is a total.
  const roll = useRoll(null, { eager: true });
  const bundle: WardsBundle | null = roll.wards;

  const role = profile?.role ?? null;
  const wardNo = profile?.wardNo ?? null;

  // Memoised on its own: an object literal in the render body is a new
  // reference every pass, which would make every `useMemo` below that lists
  // it as a dependency recompute unconditionally.
  const scope = useMemo(() => ({ wardNo }), [wardNo]);

  const allowedWards = useMemo(() => {
    const all = (bundle?.wards ?? []).map((ward) => ward.wardNo);
    return all.filter((wardNo) => canReadWard(role, scope, wardNo));
  }, [bundle, role, scope]);

  const restricted =
    allowedWards.length > 0 && allowedWards.length < (bundle?.wards.length ?? 0);

  const reports = useMemo<WardReport[]>(() => {
    const byWard = new Map<number, WardReport>();

    for (const ward of bundle?.wards ?? []) {
      if (restricted && !allowedWards.includes(ward.wardNo)) continue;
      byWard.set(ward.wardNo, {
        wardNo: ward.wardNo,
        boothNo: ward.boothNo,
        roomNo: ward.roomNo,
        boothAddress: ward.boothAddress,
        delimitation: ward.delimitation,
        total: ward.voterCount,
        male: ward.male,
        female: ward.female,
        third: ward.thirdGender,
        voted: 0,
        photos: 0,
        edited: 0,
      });
    }

    // `roll.voters` spans every ward (the hook starts with wardNo = null) and
    // is already merged with the overlay, so one pass fills all counters.
    for (const voter of roll.voters as VoterView[]) {
      const target = byWard.get(voter.wardNo);
      if (!target) continue;
      if (voter.voted === 'voted') target.voted += 1;
      if (voter.photoUrl) target.photos += 1;
      if (voter.pending) target.edited += 1;
    }

    return [...byWard.values()].sort((a, b) => a.wardNo - b.wardNo);
  }, [bundle, roll.voters, restricted, allowedWards]);

  const totals = useMemo(
    () =>
      reports.reduce(
        (acc, ward) => ({
          total: acc.total + ward.total,
          male: acc.male + ward.male,
          female: acc.female + ward.female,
          voted: acc.voted + ward.voted,
          photos: acc.photos + ward.photos,
          edited: acc.edited + ward.edited,
        }),
        { total: 0, male: 0, female: 0, voted: 0, photos: 0, edited: 0 }
      ),
    [reports]
  );

  if (roll.loading) {
    return (
      <View style={styles.pad}>
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} height={120} variant='rounded' />
        ))}
      </View>
    );
  }

  // No role is a real state, not an empty report. Every signed-in account starts
  // with no capabilities, and `firestore.rules` denies every read — so without
  // this branch a user with no role sees "No voters synced yet", which reads as
  // a data problem and sends them chasing one that does not exist.
  if (!can(role, 'voterRead')) {
    return (
      <View style={styles.center}>
        <EmptyState
          icon={ShieldAlert}
          title={t('common.noRoleTitle')}
          body={t('common.noRoleBody')}
        />
      </View>
    );
  }

  if (roll.error || !reports.length) {
    return (
      <View style={styles.center}>
        <EmptyState
          icon={BarChart3}
          title={t('reports.title')}
          body={roll.error ? t('voters.errorBody') : t('reports.emptyBody')}
        />
      </View>
    );
  }

  const turnoutPercent = totals.total ? (totals.voted / totals.total) * 100 : 0;

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.pad}>
        <Card style={styles.card}>
          <Text variant='caption' style={{ color: outline }}>
            {t('reports.turnout')}
          </Text>
          <Text variant='heading'>
            {t('reports.tally', { count: totals.voted, total: totals.total })}
          </Text>
          <ProgressRail
            label={t('reports.marked')}
            percent={turnoutPercent}
            rightLabel={`${Math.round(turnoutPercent)}%`}
            warnBelow={1}
          />
          <View style={styles.statRow}>
            <Text variant='caption' style={{ color: outline }}>
              {t('reports.photos')}: {totals.photos}
            </Text>
            <Text variant='caption' style={{ color: outline }}>
              {t('reports.pending')}: {totals.edited}
            </Text>
          </View>
          {/* The roll's own census — present from the first launch, before any
              field work, so the summary is never just zeros. */}
          <View style={styles.statRow}>
            <Text variant='caption' style={{ color: outline }}>
              {t('reports.male')}: {totals.male}
            </Text>
            <Text variant='caption' style={{ color: outline }}>
              {t('reports.female')}: {totals.female}
            </Text>
          </View>
        </Card>

        {restricted ? (
          <Text variant='caption' style={{ color: outline }}>
            {t('reports.assignedOnly', { no: allowedWards[0] ?? '' })}
          </Text>
        ) : null}

        <SectionHeader
          title={t('reports.title')}
          hint={t('voters.count', { count: reports.length })}
        />

        {reports.map((ward) => {
          const percent = ward.total ? (ward.voted / ward.total) * 100 : 0;
          return (
            <Pressable
              key={ward.wardNo}
              onPress={() =>
                router.push({
                  // Not `/(tabs)/voters/index`: an `index` route is addressed by
                  // its folder path. expo-router's typed routes reject the
                  // explicit `/index` form, which is how this was caught.
                  pathname: '/(tabs)/voters',
                  params: { ward: String(ward.wardNo) },
                })
              }
              accessibilityRole='button'
              style={({ pressed }) => [styles.wardCard, pressed && styles.pressed]}
            >
              <Card style={styles.card}>
                <View style={styles.wardHead}>
                  <Text>
                    {t('voters.ward', { no: ward.wardNo })} · {t('common.booth')}{' '}
                    {ward.boothNo}
                  </Text>
                  <Chip
                    label={`${Math.round(percent)}%`}
                    tone={percent >= 50 ? 'success' : 'primary'}
                  />
                </View>
                <ProgressRail
                  label={t('reports.tally', {
                    count: ward.voted,
                    total: ward.total,
                  })}
                  percent={percent}
                  warnBelow={1}
                />
                <View style={styles.statRow}>
                  <Text variant='caption' style={{ color: outline }}>
                    {t('reports.photos')}: {ward.photos}
                  </Text>
                  <Text variant='caption' style={{ color: outline }}>
                    {t('reports.pending')}: {ward.edited}
                  </Text>
                </View>
                {/* Ward census — from `wards-summary.csv`, always populated. */}
                <View style={styles.statRow}>
                  <Text variant='caption' style={{ color: outline }}>
                    {t('reports.male')}: {ward.male}
                  </Text>
                  <Text variant='caption' style={{ color: outline }}>
                    {t('reports.female')}: {ward.female}
                  </Text>
                  {ward.third > 0 ? (
                    <Text variant='caption' style={{ color: outline }}>
                      {t('reports.third')}: {ward.third}
                    </Text>
                  ) : null}
                </View>
                {/* Booth logistics: where to actually go on polling day. */}
                <Text variant='caption' style={{ color: outline }}>
                  {t('reports.room')}: {ward.roomNo} · {ward.boothAddress}
                </Text>
                <Text variant='caption' numberOfLines={2} style={{ color: outline }}>
                  {ward.delimitation}
                </Text>
              </Card>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  pad: { padding: 20, paddingTop: 8, paddingBottom: 112, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { gap: 8 },
  wardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  wardCard: { borderRadius: 20 },
  pressed: { opacity: 0.7 },
});
