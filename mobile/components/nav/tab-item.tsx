import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { View } from '@/components/ui/view';
import { useColor } from '@/hooks/useColor';
import { iconPop } from '@/lib/animation';
import { typeStyle } from '@/theme/typography';
import type { LucideProps } from 'lucide-react-native';
import { useEffect, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

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
};

/**
 * One tab in the floating bar (plan §8, `tab-item`).
 *
 * Inactive: icon only. Active: the label mounts next to it. Every item is
 * `flex: 1`, so the cell a label grows into has fixed bounds — the mount
 * changes what is *inside* the cell, never the cell itself, which is what
 * lets the bar place the indicator by arithmetic (see `floating-tab-bar`)
 * instead of chasing per-item layout events.
 */
export function TabItem({
  label,
  icon,
  focused,
  badge,
  color,
  inactiveColor,
  onPress,
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

  return (
    <Pressable
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

      {/* The label mounts with the tab instead of fading in: animations are
          off app-wide (see `lib/anim-off.ts`), and a fade-in here also used to
          delay the row's `onLayout` measurement by a frame. */}
      {focused && (
        <View style={styles.labelWrap}>
          <Text
            variant='caption'
            numberOfLines={1}
            style={[typeStyle('labelMd', lang), { color }]}
          >
            {label}
          </Text>
        </View>
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
    // Equal cells: the row divides its width evenly no matter which label is
    // mounted, so a focus change never reflows the row or moves the
    // indicator. No `minWidth` — it would break the equal division.
    flex: 1,
    paddingHorizontal: 8,
    borderRadius: 999,
  },
  labelWrap: {
    // A long label truncates inside its cell instead of pushing past it.
    flexShrink: 1,
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
