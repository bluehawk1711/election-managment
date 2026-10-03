import { Button, ButtonSize, ButtonVariant } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { useModeToggle } from '@/hooks/useModeToggle';
import { Moon, Sun } from 'lucide-react-native';

/**
 * Appearance toggle.
 *
 * **Intentionally not animated.** This used to run a Reanimated worklet:
 *
 *     scale.value = withTiming(0, { duration: 150 }, () => {
 *       runOnJS(setShowIcon)(...);
 *       scale.value = withTiming(1, { duration: 150 });   // ← recursion
 *     });
 *
 * Writing `.value` from inside the completion callback of an animation on that
 * same value re-schedules the UI-thread worklet synchronously, which
 * re-serialises the closure, which schedules it again — unbounded. On every
 * theme switch it threw `RangeError: Maximum call stack size exceeded` with
 * thousands of identical frames, which on React Native is a hard JS-thread
 * stall, not a cosmetic glitch.
 *
 * A spinning sun is not worth that. The icon swaps instantly, which is also
 * what a platform-native toggle does. If animation comes back it has to come
 * from a single shared value written exactly once per change — never from
 * inside a completion callback.
 */
type Props = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  haptic?: boolean;
};

export const ModeToggle = ({
  variant = 'outline',
  size = 'icon',
  haptic = true,
}: Props) => {
  const { toggleMode, isDark } = useModeToggle();

  return (
    <Button
      variant={variant}
      size={size}
      onPress={toggleMode}
      haptic={haptic}
      accessibilityRole='button'
      accessibilityLabel={`Switch to ${isDark ? 'light' : 'dark'} theme`}
    >
      <Icon name={isDark ? Moon : Sun} size={24} />
    </Button>
  );
};