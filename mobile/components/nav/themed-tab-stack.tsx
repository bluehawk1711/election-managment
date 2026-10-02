import { Text } from '@/components/ui/text';
import { useColor } from '@/hooks/useColor';
import { useColorScheme } from '@/hooks/useColorScheme';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Stack } from 'expo-router';
import { Platform } from 'react-native';

type TabStackScreen = {
  name: string;
  title: string;
  /** Screens that render their own header (dashboard) opt out of the stack header. */
  headerShown?: boolean;
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
        headerTransparent: true,
        headerTintColor: text,
        headerBlurEffect: isLiquidGlassAvailable()
          ? undefined
          : scheme === 'dark'
            ? 'systemMaterialDark'
            : 'systemMaterialLight',
        headerStyle: {
          backgroundColor: isLiquidGlassAvailable() ? 'transparent' : background,
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
