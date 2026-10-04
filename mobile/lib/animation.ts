import { withSequence, withSpring } from '@/lib/anim-off';

/**
 * The one place animation curves live (plan §8). The floating tab bar is the
 * first consumer; every later animated component (list transitions, chart
 * entrances, sheet grabs) pulls its springs from here instead of tuning
 * damping numbers at the call site.
 */

/** Indicator travel across the tab row — damping ≈ 18 per the tab-bar spec. */
export const TAB_SPRING = { damping: 18, stiffness: 190, mass: 0.9 };

/** Label slide-ins: slightly snappier so text lands before the pill settles. */
export const LABEL_SPRING = { damping: 20, stiffness: 220, mass: 0.8 };

const POP_SWELL = { damping: 12, stiffness: 320, mass: 0.6 };
const POP_SETTLE = { damping: 14, stiffness: 240, mass: 0.7 };

/**
 * One-shot scale for a tab icon becoming active: a quick swell past 1, then
 * a springy settle back to 1. Assign to a shared value on focus:
 *
 *   scale.value = iconPop();
 */
export function iconPop() {
  return withSequence(withSpring(1.14, POP_SWELL), withSpring(1, POP_SETTLE));
}
