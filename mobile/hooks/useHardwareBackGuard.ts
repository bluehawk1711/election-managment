import { hasBackHistory } from '@/lib/back-history';
import { useNavigationContainerRef } from 'expo-router';
import { useEffect } from 'react';
import { BackHandler } from 'react-native';

/**
 * Safety net for the Android hardware back button (expo/expo#33489).
 *
 * ## The failure this prevents
 *
 * The default handler is:
 *
 * ```js
 * if (navigation.canGoBack()) { navigation.goBack(); return true; }
 * return false; // → BackHandler.exitApp()
 * ```
 *
 * On a tree shaped like this one — root Stack → Tabs → per-tab Stack —
 * `canGoBack()` has a documented false-negative: it reports `false` while a
 * tab's inner stack still has screens under it. Nothing else handles the
 * press, so the user is thrown out of the app entirely: the number-one
 * complaint ("pressing the back button closes the app"), reported against
 * screens the header back button pops from just fine.
 *
 * ## How the fallback is wired
 *
 * `BackHandler` invokes listeners **last-registered-first** (RN's
 * `BackHandler.android.js`), and the first `true` wins. The container —
 * which registers expo-router's handler in an effect — is an *ancestor* of
 * everything in `app/_layout.tsx`, and React runs child effects before
 * parent effects. So the ordering is guaranteed:
 *
 * 1. expo-router's handler runs first (registered second). When the state
 *    tree is fine it pops and returns `true`, and this guard never runs —
 *    no double-pop, no behaviour change on the healthy path.
 * 2. Only when it *declines* does this guard run. It now ignores
 *    `canGoBack()` entirely and reads the state tree directly with
 *    `lib/back-history.ts` — the same `StackRouter` / `TabRouter`
 *    `GO_BACK` conditions those routers will actually be asked. If a pop
 *    exists, dispatch `goBack()` — the same dispatch a working default
 *    handler performs — and consume the press.
 * 3. Return `false` only at the genuine app root (tab stack one deep, no tab
 *    history), where exiting is the correct Android behaviour.
 *
 * The walk is pure and unit-tested (`__tests__/back-history.test.ts`); this
 * hook is only the wiring.
 */
export function useHardwareBackGuard(): void {
  // `store.navigationRef` — the same ref the default handler holds. May be
  // unready during boot; the guard then declines, exactly like the default.
  const navigationRef = useNavigationContainerRef();

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!navigationRef.isReady()) return false;

      if (!hasBackHistory(navigationRef.getRootState())) return false;

      navigationRef.goBack();
      return true;
    });

    return () => subscription.remove();
  }, [navigationRef]);
}