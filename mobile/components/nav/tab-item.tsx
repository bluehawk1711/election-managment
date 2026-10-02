import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { View } from '@/components/ui/view';
import { useColor } from '@/hooks/useColor';
import { iconPop } from '@/lib/animation';
import { typeStyle } from '@/theme/typography';
import type { LucideProps } from 'lucide-react-native';
import { useEffect, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, type LayoutChangeEvent } from 'react-native';
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

export type TabFrame = { x: number; width: number };

type TabItemProps = {
  label: string;
  icon: ComponentType<LucideProps>;
  focused: boolean;
  /** Optional count badge (future: open tasks); renders nothing when absent. */
  badge?: number;
  /** Foreground while focused (the active pill's on-color). */
  color: string;
  inactiveColor: string;
  onPress: () => void;
  /** Reports this item's measured x/width inside the row, for the indicator. */
  onFrame: (frame: TabFrame) => void;
};

/**
 * One tab in the floating bar (plan §8, `tab-item`).
 *
 * Inactive: icon only. Active: the label mounts next to it (entering fade)
 * and the indicator — driven by the frame this component reports from
 * `onLayout` — springs to cover the grown content. The mount is what makes
 * the measurement honest: the row lays out at full icon+label width in the
 * same frame the label first appears, so the indicator chases a single final
 * target rather than a stream of half-animated widths.
 */
export function TabItem({
  label,
  icon,
  focused,
  badge,
  color,
  inactiveColor,
  onPress,
  onFrame,
}: TabItemProps) {
  const { i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? i18n.language;

  const destructive = useColor('destructive');
  const destructiveForeground = useColor('destructiveForeground');

  const scale = useSharedValue(1);
  useEffect(() => {
    if (focused) {
      scale.value = iconPop();
    }
  }, [focused, scale]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handleLayout = (event: LayoutChangeEvent) => {
    const { x, width } = event.nativeEvent.layout;
    onFrame({ x, width });
  };

  return (
    <Pressable
      onLayout={handleLayout}
      onPress={onPress}
      hitSlop={6}
      accessibilityRole='tab'
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.item,
        pressed && styles.pressed,
        // Items render after the absolute indicator, but pin the order so
        // Android never composites the fill over an icon.
        { zIndex: 1 },
      ]}
    >
      <Animated.View style={iconStyle}>
        <Icon name={icon} size={20} color={focused ? color : inactiveColor} />
      </Animated.View>

      {focused && (
        <Animated.View entering={FadeIn.duration(160)}>
          <Text
            variant='caption'
            numberOfLines={1}
            style={[typeStyle('labelMd', lang), { color }]}
          >
            {label}
          </Text>
        </Animated.View>
      )}

      {badge != null && badge > 0 && (
        <View style={[styles.badge, { backgroundColor: destructive }]}>
          <Text
            variant='caption'
            style={[
              typeStyle('labelSm', lang),
              styles.badgeText,
              { color: destructiveForeground },
            ]}
          >
            {badge > 99 ? '99+' : String(badge)}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 14,
    borderRadius: 999,
  },
  pressed: {
    opacity: 0.65,
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 6,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 0,
  },
});
