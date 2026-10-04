/**
 * Animations, switched off — one import swap instead of fifteen rewrites.
 *
 * Every animated component in this app reached for `withTiming` / `withSpring`
 * to move a shared value toward a target. This module re-exports the parts of
 * `react-native-reanimated` those components use **except** the timing
 * primitives, which are replaced by functions that jump straight to the final
 * value:
 *
 *     opacity.value = withTiming(0, { duration: 300 }, done);
 *     // → done(true) runs now, opacity.value = 0 now. No 300 ms of worklet
 *     //   frames, no half-finished state to wait out.
 *
 * Pointing a component at this module is therefore behaviour-preserving with
 * the animation removed: the shared value still ends up exactly where the
 * animation would have ended up, and the completion callback still fires —
 * synchronously, with `finished === true`, which is the whole point. Those
 * callbacks are what unmount toasts, sheets and dialogs, so skipping them
 * would leave overlays stuck on screen; every call site runs from an event
 * handler or an effect, never from render, so invoking them inline is safe.
 *
 * ## Why a shim rather than deleting the animation calls
 *
 * The alternative was editing ~15 components by hand — touching gesture snap-
 * backs, modal exit callbacks and chart draw-ins one at a time, with a subtly
 * different "no animation" in each. Here the policy is stated once, a new
 * `withTiming` call site is automatically covered, and the *only* thing that
 * can regress is a value that no longer animates.
 *
 * ## What is deliberately NOT routed through here
 *
 * - `useSharedValue` and friends must keep coming from
 *   `react-native-reanimated`. React Compiler's `react-hooks/immutability`
 *   rule only recognises a shared value as mutable when the hook is imported
 *   from the real module — route it through this file and every
 *   `x.value = …` assignment is reported as an illegal mutation. So the split
 *   is: **hooks and views from Reanimated, timing primitives from here.**
 * - `components/ui/spinner.tsx` — a frozen spinner reads as a hung app. The
 *   rotating loader is activity *feedback*, not decoration, and it costs one
 *   small view on the UI thread while something is actually loading. It also
 *   keeps importing `withRepeat` from Reanimated, so it keeps spinning.
 * - `components/ui/parallax-scrollview.tsx` — that transform is driven by the
 *   user's own scroll offset, not by a timer, so there is nothing to remove.
 * - React Navigation's screen transitions — those live in
 *   `react-native-screens`, not Reanimated; they are turned off with
 *   `animation: 'none'` in each `_layout.tsx`.
 *
 * The exports are only the timing primitives, so a component that wants
 * something else imports it from Reanimated by construction — there is no
 * path back to an animating `withTiming`.
 */

/**
 * Runs the completion callback immediately and resolves to the target value.
 *
 * Shared values accept a plain number, so assigning the destination is exactly
 * what the animation would have converged to — just this frame instead of
 * N frames later.
 */
function instant<T>(toValue: T, callback?: (finished: boolean) => void): T {
  callback?.(true);
  return toValue;
}

/** Reanimated's timing, minus the timing. */
export function withTiming<T>(
  toValue: T,
  _config?: unknown,
  callback?: (finished: boolean) => void
): T {
  return instant(toValue, callback);
}

/** Reanimated's spring, minus the oscillation. */
export function withSpring<T>(
  toValue: T,
  _config?: unknown,
  callback?: (finished: boolean) => void
): T {
  return instant(toValue, callback);
}

/**
 * A delay with nothing to delay: the inner animation has already resolved to
 * its final value (these primitives are all synchronous here), so the callback
 * — if the caller passed one on the delay rather than the animation — fires
 * now too.
 */
export function withDelay<T>(
  _delayMs: number,
  animation: T,
  callback?: (finished: boolean) => void
): T {
  return instant(animation, callback);
}

/** Repeated forever is still one instant jump. */
export function withRepeat<T>(
  animation: T,
  _repetitions?: number,
  _reverse?: boolean
): T {
  return animation;
}

/** A sequence of steps, collapsed to its final step. */
export function withSequence<T>(...values: T[]): T {
  return values[values.length - 1];
}
