import { StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';

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
    top: 0,
    bottom: 0,
    borderRadius: 999,
  },
});
