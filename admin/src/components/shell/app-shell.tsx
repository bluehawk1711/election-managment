'use client';

/**
 * The shell: sidebar rail + glass topbar + the routed content slot.
 *
 * The content slot is an `AnimatePresence mode="wait"` keyed by pathname, so
 * route changes cross-fade: the old page lifts out as the new one settles in
 * (see `motion-page.tsx` for the variants every page inherits). "wait" mode
 * matters — entering before the exit finished double-paints scroll positions
 * and looks like a jump cut on long tables.
 *
 * The main column's margin animates alongside the rail's width using the
 * same token widths (264 / 84), so the drawer and the content never desync
 * mid-collapse.
 */
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/util';
import { useUi } from '@/stores/ui';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

export function AppShell({ children }: { children: React.ReactNode }) {
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const pathname = usePathname();

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen">
        <Sidebar />
        <div
          className={cn(
            'flex min-h-screen flex-col transition-[margin] duration-300 ease-in-out',
            collapsed ? 'md:ml-[84px]' : 'md:ml-[264px]'
          )}
        >
          <Topbar />
          <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-7 md:px-8">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={pathname}>{children}</motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>
    </MotionConfig>
  );
}