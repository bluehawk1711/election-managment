import { Sparkline } from '@/components/campaign/sparkline';
import { Chip, ChipTone } from '@/components/campaign/chip';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useColor } from '@/hooks/useColor';
import { BORDER_RADIUS } from '@/theme/globals';
import { typeStyle } from '@/theme/typography';
import { LucideProps } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';

type Props = {
  icon: React.ComponentType<LucideProps>;
  chipLabel: string;
  chipTone: ChipTone;
  value: string;
  label: string;
  series: number[];
  colorName?: string;
  /**
   * Where the tile leads. Every dashboard number is a door into the screen
   * that owns it — a metric you cannot open is a poster, not an instrument.
   */
  onPress?: () => void;
};

/** 2×2 dashboard metric tile — icon box + chip, big value, label, sparkline. */
export function MetricTile({ icon, chipLabel, chipTone, value, label, series, colorName = 'primary', onPress }: Props) {
  const card = useColor('card');
  const border = useColor('border');
  const iconBg = useColor('muted');
  const outline = useColor('outline');

  return (
    // The Pressable IS the tile (style on the wrapper, not a child View): as
    // a flex child of the two-up row it has to stretch to its half, and an
    // unstyled wrapper would shrink to content and collapse the grid.
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: card, borderColor: border },
        pressed && onPress ? { opacity: 0.75 } : null,
      ]}
    >
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
    </Pressable>
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
