import { Text } from '@/components/ui/text';
import { View } from '@/components/ui/view';
import { useColor } from '@/hooks/useColor';
import { typeStyle } from '@/theme/typography';
import { StyleSheet } from 'react-native';

type ColorName = Parameters<typeof useColor>[0];

export type StatTone = 'default' | 'accent' | 'success' | 'warning' | 'danger';

const TONE_COLOR: Record<StatTone, ColorName> = {
  default: 'text',
  accent: 'primary',
  success: 'success',
  warning: 'warning',
  danger: 'error',
};

export interface StatCardProps {
  label: string;
  value: string;
  tone?: StatTone;
}

/**
 * The number-first tile the dashboard leads with: a tabular figure at
 * `metric` size, a quiet label underneath. Deliberately not a Card — the
 * tiles sit directly on the screen surface, separated by their own tint.
 */
export function StatCard({ label, value, tone = 'default' }: StatCardProps) {
  const color = useColor(TONE_COLOR[tone]);

  return (
    <View style={styles.tile}>
      <Text style={[typeStyle('metric'), { color, fontVariant: ['tabular-nums'] }]}>
        {value}
      </Text>
      <Text variant='caption'>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 2,
    minHeight: 76,
    justifyContent: 'center',
  },
});
