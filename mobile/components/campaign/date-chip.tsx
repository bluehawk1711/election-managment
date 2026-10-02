import { Text } from '@/components/ui/text';
import { View } from '@/components/ui/view';
import { useColor } from '@/hooks/useColor';
import { formatMonthChip } from '@/lib/format';
import { BORDER_RADIUS } from '@/theme/globals';
import { typeStyle } from '@/theme/typography';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

/** Compact OCT/05 date tile for schedule rows. */
export function DateChip({ millis }: { millis: number }) {
  const { i18n } = useTranslation();
  const container = useColor('secondary');
  const accent = useColor('error');
  const text = useColor('text');
  const { month, day } = formatMonthChip(millis, i18n.language);

  return (
    <View style={[styles.root, { backgroundColor: container }]}>
      <Text style={[typeStyle('labelSm'), { color: accent }]}>{month}</Text>
      <Text style={[typeStyle('headlineSm'), { color: text, fontVariant: ['tabular-nums'] }]}>
        {day}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: 52,
    paddingVertical: 8,
    borderRadius: BORDER_RADIUS,
    alignItems: 'center',
    gap: 0,
  },
});
