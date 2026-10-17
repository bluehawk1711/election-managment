'use client';

/**
 * Every routed page's entrance — the ONE shared route-transition contract:
 *
 *   in  → opacity 0→1 with a 14px rise (content "settling" onto the canvas)
 *   out → opacity 1→0 with a smaller, faster sink (a peel, not a fall)
 *
 * Applied by `AppShell`'s AnimatePresence keyed on pathname: pages wrap their
 * root in `<MotionPage>` and get the same timing curve everywhere, so moving
 * between sections feels like one instrument, not five. Motion here encodes
 * the genuine state change — which screen owns the viewport — not decoration;
 * `prefers-reduced-motion` users get it honoured via MotionConfig in the
 * shell wrapper (Motion's reduced-motion support reads the browser setting).
 */
import { motion } from 'motion/react';
import type { ReactNode } from 'react';

const EASE = [0.22, 1, 0.36, 1] as const;

export const pageVariants = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
} as const;

export function MotionPage({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial={pageVariants.initial}
      animate={pageVariants.animate}
      exit={pageVariants.exit}
      transition={{ duration: 0.3, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** Staggered children container — tables/cards fade in row by row. */
export function Stagger({
  children,
  className,
  delay = 0,
  step = 0.045,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  step?: number;
}) {
  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: step, delayChildren: delay } },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** One staggered row/item — pair with `<Stagger>`. Inherits timing. */
export function StaggerItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 10 },
        show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE } },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}