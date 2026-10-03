import { Chip } from '@/components/campaign/chip';
import { DetailRow } from '@/components/roll/detail-row';
import { SectionHeader } from '@/components/campaign/section-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { useColor } from '@/hooks/useColor';
import { useReference } from '@/providers/reference-provider';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Users, Vote } from 'lucide-react-native';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

/**
 * Booth detail.
 *
 * Reads the shared reference data (`ReferenceProvider`) rather than issuing a
 * query of its own — the booth list already subscribed to it, so this screen
 * costs no extra read and works with nothing but the id in the URL.
 *
 * The voter roll is keyed by *ward number* while booths are keyed by ward id,
 * and the two only line up once the roll has been seeded, so the hand-off here
 * is deliberately to the roll as a whole rather than a fake ward filter.
 */
export default function BoothDetailScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const reference = useReference();
  const outline = useColor('outline');

  const params = useLocalSearchParams<{ id: string }>();
  const boothId = String(params.id ?? '');

  const booth = useMemo(
    () => reference.booths.find((item) => item.id === boothId),
    [reference.booths, boothId]
  );

  if (reference.loading) {
    return (
      <View style={styles.root}>
        <View style={styles.pad}>
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} height={76} variant='rounded' />
          ))}
        </View>
      </View>
    );
  }

  if (!booth) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text variant='caption'>{t('booths.noMatches')}</Text>
        <Button size='sm' variant='outline' onPress={() => router.back()}>
          {t('common.back')}
        </Button>
      </View>
    );
  }

  const coordinator = reference.memberName(booth.coordinatorId);
  const staffed = !!booth.coordinatorId;

  return (
    <View style={styles.root}>
      <View style={styles.pad}>
        <Card style={styles.card}>
          <View style={styles.headRow}>
            <Text variant='heading'>{reference.boothLabel(booth.id)}</Text>
            <Chip
              label={staffed ? t('booths.ready') : t('booths.unassigned')}
              tone={staffed ? 'success' : 'danger'}
            />
          </View>
          <Text variant='caption' style={{ color: outline }}>
            {[booth.name, reference.areaContext(booth.areaId)]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </Card>

        <SectionHeader title={t('common.overview')} />
        <Card style={styles.card}>
          <DetailRow label={t('common.address')} value={booth.address} />
          <DetailRow label={t('booths.coordinator')} value={coordinator} />
          <DetailRow
            label={t('booths.estimatedVoters')}
            value={String(booth.estimatedVoters)}
          />
          <DetailRow label={t('common.ward')} value={reference.wardName(booth.wardId)} />
        </Card>

        <Button
          variant='outline'
          icon={Users}
          onPress={() => router.push('/(tabs)/voters')}
        >
          {t('voters.title')}
        </Button>
        <Button variant='outline' icon={Vote} onPress={() => router.push('/(tabs)/reports')}>
          {t('reports.title')}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  pad: { padding: 20, paddingTop: 8, paddingBottom: 112, gap: 12 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  card: { gap: 8 },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
});
