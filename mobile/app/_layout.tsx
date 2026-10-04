import { Spinner } from '@/components/ui/spinner';
import { ToastProvider } from '@/components/ui/toast';
import { View } from '@/components/ui/view';
import { useColorScheme } from '@/hooks/useColorScheme';
import { prewarm } from '@/lib/cache/query-cache';
import { cacheStorage, prewarm as prewarmRoll } from '@/lib/roll/cache';
import '@/i18n';
import { AuthProvider, useAuth } from '@/providers/auth-provider';
import { ReferenceProvider } from '@/providers/reference-provider';
import { ThemeProvider } from '@/providers/theme-provider';
import { Colors } from '@/theme/colors';
import { FONT_ASSETS } from '@/theme/typography';
import * as NavigationBar from 'expo-navigation-bar';


import { Stack } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { setBackgroundColorAsync } from 'expo-system-ui';
import { useFonts } from 'expo-font';
import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

SplashScreen.preventAutoHideAsync().catch(() => {});

SplashScreen.setOptions({
  duration: 200,
  fade: true,
});

/**
 * The three route groups and the conditions under which each is reachable.
 *
 * `Stack.Protected` unmounts the screens whose guard is false and redirects
 * away from them, so this is not a cosmetic hide: with no signed-in user there is no
 * navigation path into `(tabs)` at all, deep link or otherwise. The guards are
 * mutually exclusive, so exactly one group is mounted at a time.
 *
 * Guards are a convenience, not the boundary — firestore.rules says the same
 * thing server-side, where a modified client cannot argue. A query that is not
 * scoped to the signed-in uid fails there regardless of what this file does.
 */
function RootNavigator() {
  const { user, profile, loading } = useAuth();

  // `onAuthStateChanged` fires once after the SDK has finished reading
  // LargeSecureStore, which takes a beat. Rendering the navigator before it
  // resolves flashes the sign-in screen at a user who is already signed in.
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Spinner size='lg' variant='circle' />
      </View>
    );
  }

  const signedIn = !!user;
  // While the profile document is still being created, `profile` is null.
  // There is no trigger doing it — the provider writes it from its snapshot
  // listener — so this window is real. Treating null as "not onboarded" would
  // flash the onboarding screen at a returning user, so hold them in the app
  // until it arrives.
  const needsOnboarding = signedIn && profile?.onboarded === false;

  const stack = (
    <Stack
      screenOptions={{
        headerShown: false,
        // No screen-transition animation anywhere in the app. Native-stack
        // defaults to a slide on every push and modal presentation, and on a
        // mid-range Android that transition is a full-scene re-render measured
        // in hundreds of milliseconds — the most consistently "the app is
        // slow" feeling thing in the build. See `lib/anim-off.ts` for the
        // in-component half of the same policy.
        animation: 'none',
      }}
    >
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name='(auth)' options={{ headerShown: false }} />
      </Stack.Protected>

      <Stack.Protected guard={needsOnboarding}>
        <Stack.Screen name='(onboarding)' options={{ headerShown: false }} />
      </Stack.Protected>

      <Stack.Protected guard={signedIn && !needsOnboarding}>
        <Stack.Screen name='(tabs)' options={{ headerShown: false }} />
      </Stack.Protected>

      <Stack.Screen name='+not-found' />
    </Stack>
  );

  // The shared reference data (geography, booths, roster, campaign profile)
  // only exists during an authed session — nothing subscribes while signed
  // out, and the rules would deny every one of those reads anyway.
  return signedIn && !needsOnboarding ? (
    <ReferenceProvider>{stack}</ReferenceProvider>
  ) : (
    stack
  );
}

/**
 * Status bar, Android navigation bar and root background, kept in step with the
 * theme.
 *
 * A component rather than inline in `RootLayout` so `useColorScheme()` resolves
 * *inside* `ThemeProvider`. Read above it and this would see the OS scheme
 * rather than the user's choice — which on native the global `Appearance`
 * override happens to paper over, but on web would leave the system chrome
 * stuck on the system theme.
 */
function SystemChrome() {
  const colorScheme = useColorScheme() || 'light';

  useEffect(() => {
    if (Platform.OS === 'android') {
      // `setButtonStyleAsync` was removed in expo-navigation-bar 57; `setStyle`
      // is the replacement and is synchronous.
      NavigationBar.setStyle(colorScheme === 'light' ? 'dark' : 'light');
    }
  }, [colorScheme]);

  // Keep the root view background color in sync with the current theme
  useEffect(() => {
    setBackgroundColorAsync(
      colorScheme === 'dark' ? Colors.dark.background : Colors.light.background
    );
  }, [colorScheme]);

  return (
    <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} animated />
  );
}

export default function RootLayout() {
  // Inter + Noto Sans Devanagari. Hidden splash until the glyphs are usable —
  // Devanagari without its font renders as tofu on a fresh install.
  const [fontsLoaded, fontError] = useFonts(FONT_ASSETS);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    // Drain the persisted caches into memory at startup, *before* sign-in.
    //
    // This is the whole reason both caches have a memory layer: by the time
    // the user authenticates and `(tabs)` mounts, `ReferenceProvider` and
    // `useRoll` read them **synchronously** and the first frame is real
    // content rather than skeletons. The network fetches still run — they just
    // refine what is already on screen instead of gating it.
    //
    // Deliberately not awaited and not gated on the splash: nothing here
    // renders, and blocking the sign-in screen on a storage read would be a
    // worse version of the problem being solved.
    prewarm().catch(() => {});
    // The roll, but only the first ward — not all thirteen. Warming the whole
    // roll would mean parsing ~6,855 rows of JSON on every cold start, which
    // costs more than the skeleton it saves. The wards bundle is 13 small
    // documents and is always warmed; the first ward is what the default "all
    // wards" selection opens on, and further wards load on demand and then stay
    // resident for the rest of the session.
    prewarmRoll(cacheStorage, [1]).catch(() => {});
  }, []);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* `storage` makes the light/dark choice survive a restart. SecureStore
          has no web implementation, so on web this degrades to no persistence
          rather than erroring — the toggle itself still works there. */}
      <ThemeProvider storage={SecureStore}>
        <SystemChrome />

        <AuthProvider>
          <ToastProvider>
            <RootNavigator />
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Nothing here gates the tree on the warm-up.
 *
 * An earlier version did, and it was wrong: hiding the tree for the duration of
 * a storage read trades a skeleton flash for a blank one. Starting the read at
 * startup and *not* awaiting it is enough — the user still has to type an email
 * and a password before `(tabs)` exists, and `prewarm()` is a handful of
 * AsyncStorage reads, so the cache is resident long before it is needed. The
 * only thing that has to be synchronous is `useCollection`'s read of the memory
 * mirror, and that is.
 */
