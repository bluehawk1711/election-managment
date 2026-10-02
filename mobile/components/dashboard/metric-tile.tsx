import { Sparkline } from '@/components/campaign/sparkline';
import { Chip, ChipTone } from '@/components/campaign/chip';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { View } from '@/components/ui/view';
import { useColor } from '@/hooks/useColor';
import { BORDER_RADIUS } from '@/theme/globals';
import { typeStyle } from '@/theme/typography';
import { LucideProps } from 'lucide-react-native';
import { StyleSheet } from 'react-native';

type Props = {
  icon: React.ComponentType<LucideProps>;
  chipLabel: string;
  chipTone: ChipTone;
  value: string;
  label: string;
  series: number[];
  colorName?: string;
};

/** 2×2 dashboard metric tile — icon box + chip, big value, label, sparkline. */
export function MetricTile({ icon, chipLabel, chipTone, value, label, series, colorName = 'primary' }: Props) {
  const card = useColor('card');
  const border = useColor('border');
  const iconBg = useColor('muted');
  const outline = useColor('outline');

  return (
    <View style={[styles.tile, { backgroundColor: card, borderColor: border }]}>
      <View style={styles.top}>
        <View style={[styles.iconBox, { backgroundColor: iconBg }]}>
          <Icon name={icon} size={16} />
        </View>
        <Chip label={chipLabel} tone={chipTone} />
      </View>
      <Text style={[typeStyle('headlineXl'), styles.value]}>{value}</Text>
      <Text variant='caption' numberOfLines={1} style={{ color: outline }}>
        {label}
      </Text>
      <View style={styles.spark}>
        <Sparkline values={series} colorName={colorName} width={110} height={24} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    borderRadius: BORDER_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 6,
    minHeight: 148,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  iconBox: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  spark: {
    height: 24,
    marginTop: 2,
  },
});
