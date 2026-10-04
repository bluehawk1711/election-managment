import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

type Props = {
  /** Animated x offset within the tab row (pixels). */
  x: SharedValue<number>;
  /** Animated width of the active item (pixels). */
  width: SharedValue<number>;
  color: string;
};

/**
 * The pill that fills behind the active tab (plan §8, `tab-indicator`).
 *
 * Position and width are shared values the tab bar springs — with
 * `TAB_SPRING` — toward each item's measured layout, so a single element
 * glides across the row instead of five separate highlights fading in place.
 * Rendering it *under* the items (first child of the row) means icon and
 * label simply sit on top; they never need to know the fill exists.
 *
 * Width starts at 0, so the bar's first frame shows nothing and the pill
 * springs in as soon as layout reports the active item.
 *
 * Vertically inset from the row rather than filling it. `top: 0, bottom: 0`
 * made the fill as tall as a 44pt touch target plus the row's padding, which
 * read as a slab rather than a highlight — especially once it was given a solid
 * container colour. Inset by 8 on a row padded by 4 leaves a 36pt pill that
 * still lines up with the item's own width, so it tracks the label as it grows.
 */
export function TabIndicator({ x, width, color }: Props) {
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
    width: width.value,
  }));

  return (
    <Animated.View
      pointerEvents='none'
      style={[styles.base, { backgroundColor: color }, style]}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    position: 'absolute',
    left: 0,
    top: 8,
    bottom: 8,
    borderRadius: 999,
  },
});
