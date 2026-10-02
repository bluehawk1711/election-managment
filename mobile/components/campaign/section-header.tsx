import { Text } from '@/components/ui/text';
import { View } from '@/components/ui/view';
import { useColor } from '@/hooks/useColor';
import { typeStyle } from '@/theme/typography';
import { Pressable, StyleSheet, ViewStyle } from 'react-native';

type Props = {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Quiet right-aligned text when there's no action (e.g. "6 Wards"). */
  hint?: string;
  style?: ViewStyle;
};

/** Title + optional subtitle with a quiet right-aligned action link. */
export function SectionHeader({ title, subtitle, actionLabel, onAction, hint, style }: Props) {
  const outline = useColor('outline');
  const primary = useColor('primary');

  return (
    <View style={[styles.row, style]}>
      <View style={styles.text}>
        <Text style={typeStyle('headlineSm')}>{title}</Text>
        {subtitle ? (
          <Text variant='caption' style={[styles.subtitle, { color: outline }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          hitSlop={10}
          accessibilityRole='button'
          accessibilityLabel={actionLabel}
        >
          <Text style={[typeStyle('labelMd'), { color: primary }]}>{actionLabel}</Text>
        </Pressable>
      ) : hint ? (
        <Text style={[typeStyle('labelMd'), { color: outline }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  subtitle: {
    marginTop: 2,
  },
});
