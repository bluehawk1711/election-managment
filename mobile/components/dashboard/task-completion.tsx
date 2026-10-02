import { AreaChart } from '@/components/charts/area-chart';
import { Chip } from '@/components/campaign/chip';
import { Text } from '@/components/ui/text';
import { View } from '@/components/ui/view';
import { useColor } from '@/hooks/useColor';
import { formatWeekday } from '@/lib/format';
import { typeStyle } from '@/theme/typography';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';

type Props = {
  /** Completed-per-day counts, oldest first, length >= 30. */
  counts: number[];
  /** Bucket start millis, aligned with `counts`. */
  buckets: number[];
};

const RANGES = [7, 30] as const;

/** Task completion card — area chart with a 7D/30D range toggle. */
export function TaskCompletionCard({ counts, buckets }: Props) {
  const { t, i18n } = useTranslation();
  const [days, setDays] = useState<(typeof RANGES)[number]>(7);

  const primary = useColor('primary');
  const onPrimary = useColor('primaryForeground');
  const outline = useColor('outline');

  const visible = days === 7 ? counts.slice(-7) : counts;
  const visibleBuckets = days === 7 ? buckets.slice(-7) : buckets;

  const data = visible.map((value, index) => ({
    x: visibleBuckets[index] != null ? formatWeekday(visibleBuckets[index], i18n.language) : index,
    y: value,
  }));

  const peakValue = visible.length > 0 ? Math.max(...visible) : 0;
  const peakIndex = visible.indexOf(peakValue);
  const peakLabel =
    peakIndex >= 0 && visibleBuckets[peakIndex] != null && peakValue > 0
      ? `${formatWeekday(visibleBuckets[peakIndex], i18n.language)} · ${peakValue} ${t('dash.doneUnit')}`
      : null;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.titles}>
          <Text style={typeStyle('headlineSm')}>{t('dash.taskCompletion')}</Text>
          <Text variant='caption' style={{ color: outline }}>
            {t('dash.taskCompletionSub')}
          </Text>
        </View>
        <View style={styles.toggle}>
          {RANGES.map((range) => {
            const active = range === days;
            return (
              <Pressable
                key={range}
                onPress={() => setDays(range)}
                accessibilityRole='button'
                accessibilityState={{ selected: active }}
                style={[styles.segment, active ? { backgroundColor: primary } : null]}
              >
                <Text
                  style={[
                    typeStyle('labelMd'),
                    styles.segmentText,
                    { color: active ? onPrimary : outline },
                  ]}
                >
                  {range}D
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <AreaChart
        data={data}
        config={{ height: 150, showGrid: true, animated: true, interactive: true }}
      />

      <View style={styles.footer}>
        <Chip label={t('dash.rangeLabel', { days })} active tone='primary' />
        {peakLabel ? (
          <Text variant='caption' style={{ color: outline }}>
            {peakLabel}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  titles: {
    flex: 1,
    gap: 2,
  },
  toggle: {
    flexDirection: 'row',
    backgroundColor: 'rgba(120,120,140,0.12)',
    borderRadius: 999,
    padding: 3,
    gap: 2,
  },
  segment: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  segmentText: {
    textAlign: 'center',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(120,120,140,0.2)',
    paddingTop: 12,
  },
});
