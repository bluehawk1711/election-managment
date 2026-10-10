import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useColor } from '@/hooks/useColor';
import { CORNERS } from '@/theme/globals';
import { typeStyle } from '@/theme/typography';
import { LucideProps } from 'lucide-react-native';
import { Pressable, StyleSheet, ViewStyle } from 'react-native';

export type ChipTone =
  | 'default'
  | 'primary'
  | 'danger'
  | 'success'
  | 'warning'
  | 'info';

type Props = {
  label: string;
  active?: boolean;
  tone?: ChipTone;
  icon?: React.ComponentType<LucideProps>;
  onPress?: () => void;
  style?: ViewStyle;
};

const TONE_BG: Record<ChipTone, Parameters<typeof useColor>[0]> = {
  default: 'secondary',
  primary: 'primary',
  danger: 'error',
  success: 'success',
  warning: 'warning',
  info: 'info',
};

/**
 * Foreground per tone — from the token pair, not a blanket white.
 *
 * `warning` (#F59E0B) and `info` (#0EA5E9) are light enough that white on
 * them lands at ~1.9:1 and ~2.3:1 — both far below the 4.5:1 floor. Their
 * paired `*Foreground` tokens carry the dark ink that was designed for them
 * (#1A1200 / #04283A), so every tone reads at AA on both themes.
 */
const TONE_FG: Record<ChipTone, Parameters<typeof useColor>[0]> = {
  default: 'secondaryForeground',
  primary: 'primaryForeground',
  danger: 'errorForeground',
  success: 'successForeground',
  warning: 'warningForeground',
  info: 'infoForeground',
};

/** Filter/status pill — active fills with the tone, inactive sits quiet. */
export function Chip({ label, active = false, tone = 'default', icon, onPress, style }: Props) {
  const bg = useColor(TONE_BG[tone]);
  const card = useColor('card');
  const border = useColor('border');
  const text = useColor('text');
  const outline = useColor('outline');

  // One hook, one call: `useColor` only reads a key out of the theme object,
  // so a dynamic key keeps the hook count stable across renders. The pick
  // lives in `TONE_FG` — see why there (the pale `default` and light
  // `warning`/`info` fills all need dark ink, not white).
  const onTone = useColor(TONE_FG[tone]);

  const isActive = active || tone !== 'default';

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      // 34pt pill + 5pt slop on each side = 44pt effective target — the
      // accessibility floor the visual height alone misses.
      hitSlop={5}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={onPress ? { selected: active } : undefined}
      style={[
        styles.chip,
        {
          backgroundColor: isActive ? bg : card,
          borderColor: isActive ? 'transparent' : border,
        },
        style,
      ]}
    >
      {icon ? (
        <Icon name={icon} size={14} color={isActive ? onTone : outline} />
      ) : null}
      <Text
        style={[
          typeStyle('labelMd'),
          { color: isActive ? onTone : text },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    height: 34,
    borderRadius: CORNERS,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
