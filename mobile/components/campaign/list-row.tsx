import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { View } from '@/components/ui/view';
import { useColor } from '@/hooks/useColor';
import { BORDER_RADIUS } from '@/theme/globals';
import { typeStyle } from '@/theme/typography';
import { ChevronRight, LucideProps } from 'lucide-react-native';
import { Pressable, StyleSheet, ViewStyle } from 'react-native';

type Props = {
  title: string;
  subtitle?: string;
  meta?: string;
  icon?: React.ComponentType<LucideProps>;
  trailing?: React.ReactNode;
  onPress?: () => void;
  style?: ViewStyle;
  /**
   * Tints the leading medallion. Omitted → the neutral grey it always was.
   *
   * Backgrounds and inks come in *pairs* from `theme/colors.ts`
   * (primaryFixed/onPrimaryFixed, errorContainer/onErrorContainer, …) —
   * tokens documented as "identical in light & dark, they carry their own
   * ink". Pairing across sets (a raw green on `secondaryFixed`) would
   * re-test contrast per mode; these pairs are already known-good AA.
   */
  tone?: 'primary' | 'danger' | 'warning' | 'info' | 'success';
};

const TONE: Record<
  NonNullable<Props['tone']>,
  { bg: Parameters<typeof useColor>[0]; fg: Parameters<typeof useColor>[0] }
> = {
  primary: { bg: 'primaryFixed', fg: 'onPrimaryFixed' },
  danger: { bg: 'errorContainer', fg: 'onErrorContainer' },
  warning: { bg: 'secondaryFixed', fg: 'onSecondaryFixed' },
  info: { bg: 'tertiaryFixed', fg: 'onTertiaryFixed' },
  // No green pastel pair exists; `success` is dark enough in light mode
  // (#15803D, 5.0:1) and bright enough in dark (#16A34A) to sit on the
  // neutral `secondary` fill in both.
  success: { bg: 'secondary', fg: 'success' },
};

/**
 * The workhorse list row: optional leading icon medallion, title, subtitle,
 * trailing meta/badge/chevron. Whole row is one hit target.
 */
export function ListRow({
  title,
  subtitle,
  meta,
  icon,
  trailing,
  onPress,
  style,
  tone,
}: Props) {
  const card = useColor('card');
  const border = useColor('border');
  const outline = useColor('outline');
  // Untoned rows keep the exact fills they had before (`muted` medallion,
  // themed `icon` glyph) — the tone only ever overrides both together.
  const toneBg = useColor(tone ? TONE[tone].bg : 'muted');
  const toneFg = useColor(tone ? TONE[tone].fg : 'icon');

  const body = (
    <>
      {icon ? (
        <View style={[styles.medallion, { backgroundColor: toneBg }]}>
          <Icon name={icon} size={18} color={toneFg} />
        </View>
      ) : null}
      <View style={styles.text}>
        <Text numberOfLines={1} style={[typeStyle('bodyLg'), styles.title]}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} variant='caption' style={{ color: outline }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {meta ? (
        <Text variant='caption' style={[styles.meta, { color: outline }]}>
          {meta}
        </Text>
      ) : null}
      {trailing}
      {onPress && !trailing ? <Icon name={ChevronRight} size={18} color={outline} /> : null}
    </>
  );

  if (!onPress) {
    return <View style={[styles.row, styles.static, { backgroundColor: card, borderColor: border }, style]}>{body}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole='button'
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: card, borderColor: border, opacity: pressed ? 0.7 : 1 },
        style,
      ]}
    >
      {body}
    </Pressable>
  );
}


const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: BORDER_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
  },
  static: {
    opacity: 1,
  },
  medallion: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontWeight: '600',
  },
  meta: {
    alignSelf: 'center',
  },
});
