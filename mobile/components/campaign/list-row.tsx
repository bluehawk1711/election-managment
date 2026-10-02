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
};

/**
 * The workhorse list row: optional leading icon medallion, title, subtitle,
 * trailing meta/badge/chevron. Whole row is one hit target.
 */
export function ListRow({ title, subtitle, meta, icon, trailing, onPress, style }: Props) {
  const card = useColor('card');
  const border = useColor('border');
  const muted = useColor('muted');
  const outline = useColor('outline');

  const body = (
    <>
      {icon ? (
        <View style={[styles.medallion, { backgroundColor: muted }]}>
          <Icon name={icon} size={18} />
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
