import { Text } from '@/components/ui/text';
import { useColor } from '@/hooks/useColor';
import { useColorScheme } from '@/hooks/useColorScheme';
import { withOpacity } from '@/theme/colors';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Stack } from 'expo-router';
import { Platform } from 'react-native';

type TabStackScreen = {
  name: string;
  title: string;
  /** Screens that render their own header (dashboard) opt out of the stack header. */
  headerShown?: boolean;
  /** Modal presentations (task create). */
  presentation?:
    | 'card'
    | 'pageSheet'
    | 'formSheet'
    | 'modal'
    | 'containedModal'
    | 'transparentModal'
    | 'containedTransparentModal'
    | 'fullScreenModal';
};

/**
 * The header every tab's stack shares — one implementation instead of five
 * copies of the same screenOptions block: large translucent title, blur
 * material matching the current mode, and the Android header body title
 * (Android has no large-title fallback of its own).
 *
 * Each tab declares its screens as `{ name, title }`; titles come from
 * `nav.*` i18n keys at the call site, so this component stays translation
 * agnostic.
 *
 * `headerTransparent` is **false**, and that is load-bearing. When a header is
 * transparent, react-navigation reserves no space for it and the scene is laid
 * out from y=0 — so every screen has to add its own `useHeaderHeight()` offset
 * or scroll its own safe-area inset. Not one screen in this app does, because
 * a transparent header is only safe when the screen owns the padding. With it
 * on, the first card of every list rendered underneath the title.
 *
 * It also broke the back button. A transparent header is drawn in the same
 * layer as the scene, and the scene's own background wins the hit test in
 * places, so the back button was present but not reliably tappable — on some
 * screens only, which is what made it look intermittent. Letting the navigator
 * inset the scene fixes the overlap and the hit test together.
 *
 * The frosted look survives because the header paints its own scrim over the
 * blur rather than relying on the scene showing through.
 */
export function ThemedTabStack({ screens }: { screens: TabStackScreen[] }) {
  const scheme = useColorScheme();
  const text = useColor('text');
  const background = useColor('background');

  return (
    <Stack
      screenOptions={{
        headerLargeTitle: true,
        headerLargeTitleShadowVisible: false,
        // See the note above: a transparent header reserves no space, and the
        // scene then covers the back button.
        headerTransparent: false,
        headerShadowVisible: false,
        headerTintColor: text,
        headerBlurEffect: isLiquidGlassAvailable()
          ? undefined
          : scheme === 'dark'
            ? 'systemMaterialDark'
            : 'systemMaterialLight',
        headerStyle: {
          // Translucent, not opaque: an opaque `headerStyle` paints over the
          // blur effect set just above it, which is the whole point of asking
          // for a material in the first place. Liquid glass gets a fully
          // transparent bar because the system supplies its own.
          backgroundColor: isLiquidGlassAvailable()
            ? 'transparent'
            : withOpacity(background, 0.72),
        },
      }}
    >
      {screens.map((screen) => (
        <Stack.Screen
          key={screen.name}
          name={screen.name}
          options={{
            title: screen.title,
            headerShown: screen.headerShown ?? true,
            presentation: screen.presentation,
            headerTitle: () =>
              Platform.OS === 'android' ? (
                <Text variant='heading'>{screen.title}</Text>
              ) : undefined,
          }}
        />
      ))}
    </Stack>
  );
}
