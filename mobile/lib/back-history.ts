/**
 * Pure walker over a React Navigation state tree that answers exactly one
 * question: **is there anything under the current screen for the Android
 * hardware back button to pop back to?**
 *
 * ## Why this exists
 *
 * The default hardware-back handler (expo-router's fork of React
 * Navigation's `useBackButton`) is:
 *
 * ```js
 * if (navigation.canGoBack()) { navigation.goBack(); return true; }
 * return false; // → BackHandler.exitApp()
 * ```
 *
 * `canGoBack()` asks each navigator on the focused path whether it can handle
 * a `GO_BACK` — and in this tree (root Stack → Tabs → per-tab Stack) it has a
 * documented false-negative: it reports `false` while a tab's inner stack is
 * several screens deep. When that happens the guard declines, **no other
 * listener handles the press, and Android exits the app** —
 * expo/expo#33489, "Android back button is closing the app on a nested stack
 * inside tabs". The header back button keeps working throughout, because it
 * dispatches `goBack()` from the screen's own navigator, not through the
 * container-level `canGoBack()` query.
 *
 * `hooks/useHardwareBackGuard.ts` runs **after** that handler declines and
 * uses this walker to decide, straight from the state tree, whether a pop
 * exists. If it does, it dispatches `goBack()` (which works — that is the
 * same path a successful default handler takes) instead of letting the press
 * fall through to `exitApp()`.
 *
 * ## The rules, mirroring the routers
 *
 * - **Stack level** (`type !== 'tab'`): poppable while `index > 0` — that is
 *   `StackRouter`'s exact `GO_BACK` condition (`state.index > 0`).
 * - **Tab level** (`type === 'tab'`): poppable only while
 *   `history.length > 1` — the `TabRouter`'s `GO_BACK` condition. The tab
 *   `index` itself says **nothing** about history (the third tab is the focused
 *   one simply because it was launched that way), so using it here would
 *   "consume" back presses that no router would handle and turn the
 *   complaint into a dead back button instead of an exiting one.
 *
 * Every other state shape falls through to the stack rule; unknown navigator
 * types are rare (this app has Stack and Tabs only) and a stack-like reading
 * is the conservative one — it matches what a real pop would do.
 */

/** A node of the navigation state tree, as far as back-history is concerned. */
export interface BackHistoryState {
  /** Navigator type id — `'stack'` / `'tab'` after rehydration. */
  type?: string;
  /** Focused index into `routes`. Absent only on partial states. */
  index?: number;
  /** Tab routers only: the visited-tab history `GO_BACK` walks. */
  history?: readonly unknown[];
  routes: readonly BackHistoryRoute[];
}

export interface BackHistoryRoute {
  name?: string;
  /** The nested navigator's state for this route, when it has one. */
  state?: BackHistoryState | null;
}

/**
 * `true` when some navigator on the focused path can handle a `GO_BACK`
 * action — i.e. when back should navigate rather than exit the app.
 *
 * Walks root → focused leaf, checking each level with that level's own
 * router rule, and recurses into the focused route's nested state. Pure and
 * side-effect free so `__tests__/back-history.test.ts` can pin the rules
 * down without a navigator in sight.
 */
export function hasBackHistory(
  state: BackHistoryState | null | undefined
): boolean {
  if (!state || state.routes.length === 0) return false;

  const index = state.index ?? state.routes.length - 1;
  const isTab = state.type === 'tab';

  if (isTab) {
    if (Array.isArray(state.history) && state.history.length > 1) return true;
  } else if (index > 0) {
    return true;
  }

  const focused = state.routes[index];
  if (!focused) return false;
  return hasBackHistory(focused.state ?? null);
}