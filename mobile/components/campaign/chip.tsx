import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useColor } from '@/hooks/useColor';
import { CORNERS } from '@/theme/globals';
import { typeStyle } from '@/theme/typography';
import { LucideProps } from 'lucide-react-native';
import { Pressable, StyleSheet, ViewStyle } from 'react-native';

export type ChipTone = 'default' | 'primary' | 'danger' | 'success';

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
};

/** Filter/status pill — active fills with the tone, inactive sits quiet. */
export function Chip({ label, active = false, tone = 'default', icon, onPress, style }: Props) {
  const bg = useColor(TONE_BG[tone]);
  const card = useColor('card');
  const border = useColor('border');
  const text = useColor('text');
  const outline = useColor('outline');

  // Two different foregrounds, and the choice between them is the whole point.
  //
  // `primary` / `success` / `error` are saturated, so white text on them is
  // legible. But the `default` tone fills with `secondary` — a pale lavender
  // (#ECECFF in light mode) — and white on that is very close to invisible.
  // Since `isActive` is true for a *selected* default-tone chip, that made
  // exactly the thing the user is looking for — the currently-selected filter —
  // the hardest one to read. Both are resolved unconditionally because hooks
  // cannot be called conditionally; only the pick is conditional.
  const onSolid = useColor('primaryForeground');
  const onPale = useColor('secondaryForeground');
  const onTone = tone === 'default' ? onPale : onSolid;

  const isActive = active || tone !== 'default';

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
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
