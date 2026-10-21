'use client';

/**
 * The sidebar — one component that renders TWO surfaces from the same list:
 *
 *  - ≥`md`: a fixed rail whose width animates with `sidebarCollapsed`
 *    (persisted — a wide monitor owner who collapses keeps it collapsed);
 *  - <`md`: a hidden drawer behind the topbar's hamburger, opened through the
 *    same store and closed on ANY navigation (a drawer that survives a route
 *    change is the classic mobile-nav bug).
 *
 * The active item is a `layoutId` pill: when the route changes, the glow
 * *slides* between items instead of blinking on and off — motion communicating
 * where you are, which is the one navigational affordance a flat list lacks.
 */
import { AnimatePresence, motion } from 'motion/react';
import {
  ClipboardList,
  Database,
  History,
  LayoutDashboard,
  LogOut,
  PanelLeft,
  ScrollText,
  Settings,
  UserCog,
  Vote,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentType } from 'react';
import { signOut } from '@/lib/api';
import { can, type Capability } from '@/lib/roles';
import { cn } from '@/lib/util';
import { useSession } from '@/stores/session';
import { useUi } from '@/stores/ui';
import { Initials, RoleBadge } from '@/components/ui/kit';

export interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Capability required to SEE the entry — mirrored from firestore.rules. */
  cap?: Capability;
}

export const NAV: NavItem[] = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  // The roll itself, back as a real page: it now reads the STATIC bundled
  // JSON (`public/roll/`, copied from mobile's assets) instead of Firestore,
  // so the rules objection that forced the old redirect — no collection-level
  // roll read — no longer applies. Same data, same search as the field app,
  // plus the printable voter slip. `/changes` stays the audit surface.
  { href: '/voters', label: 'Voter roll', icon: ScrollText, cap: 'voterRead' },
  { href: '/tasks', label: 'Tasks', icon: ClipboardList },
  { href: '/users', label: 'Accounts', icon: UserCog, cap: 'accountView' },
  // "Which voter data changes did each user make" — the per-account
  // `voterEdits` audit, readable by the same roster tier that sees the
  // accounts themselves (firestore.rules voterEdits read).
  { href: '/changes', label: 'Voter changes', icon: History, cap: 'accountView' },
  // Roll import + per-ward verification — developer-only, like every other
  // `dataTools` surface. The import itself runs through a local API route
  // that shells out to scripts/seed-roll.mjs with the Admin SDK.
  { href: '/data', label: 'Roll import', icon: Database, cap: 'dataTools' },
  // Release control: version gate + support WhatsApp number (`appConfig`) —
  // raising `requiredVersion` locks every older build behind the update
  // modal, so it sits with account management, not admin.
  { href: '/settings', label: 'Settings', icon: Settings, cap: 'accountManage' },
];

/** What THIS session may see in the nav — same capability words as rules. */
export function visibleNav(role: string | null): NavItem[] {
  return NAV.filter((item) => !item.cap || can(role, item.cap));
}

function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

/* ------------------------------------------------------------------ brand */

function Brand({ compact }: { compact: boolean }) {
  return (
    <div className="flex h-16 items-center gap-3 px-4">
      <span className="brand-gradient grid size-9 shrink-0 place-items-center rounded-xl shadow-[0_8px_24px_-10px_rgb(99_102_241/0.9)]">
        <Vote className="size-4.5 text-white" />
      </span>
      <AnimatePresence initial={false}>
        {!compact ? (
          <motion.span
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.18 }}
            className="min-w-0"
          >
            <span className="brand-text block text-[15px] font-semibold tracking-tight">
              Campaign HQ
            </span>
            <span className="block text-[10px] font-medium uppercase tracking-[0.18em] text-mist-600">
              Admin console
            </span>
          </motion.span>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ rail */

interface RailProps {
  compact: boolean;
  onNavigate?: () => void;
  overlay?: boolean;
}

export function Rail({ compact, onNavigate, overlay = false }: RailProps) {
  const pathname = usePathname();
  const collapse = useUi((s) => s.toggleSidebar);
  const role = useSession((s) => s.role);
  const items = visibleNav(role);

  return (
    <div className="flex h-full flex-col">
      {/* Collapsed, the brand icon packs away and this becomes the ONLY
          way back to the expanded rail — so it renders in BOTH states (it
          used to be `compact && 'hidden'`, which swallowed the very button
          that un-collapses the sidebar). `rotate-180` in the compact state
          says which direction the rail will move. */}
      <div className={cn('flex items-center justify-between pr-2', compact && 'flex-col gap-2 pr-0')}>
        <Brand compact={compact} />
        {!overlay ? (
          <button
            onClick={collapse}
            aria-label={compact ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn(
              'rounded-lg p-2 text-mist-600 transition-colors hover:bg-white/5 hover:text-mist-200'
            )}
          >
            <PanelLeft className={cn('size-4 transition-transform', compact && 'rotate-180')} />
          </button>
        ) : null}
      </div>

      <nav className="mt-4 flex flex-1 flex-col gap-1 px-3">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              title={compact ? item.label : undefined}
              className={cn(
                'relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors duration-150',
                active ? 'text-white' : 'text-mist-400 hover:bg-white/[0.04] hover:text-mist-200',
                compact && 'justify-center px-0'
              )}
            >
              {active ? (
                <motion.span
                  layoutId={overlay ? 'nav-active-mobile' : 'nav-active'}
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  className="brand-gradient absolute inset-0 rounded-xl shadow-[0_8px_28px_-12px_rgb(99_102_241/0.9)]"
                  style={{ zIndex: -1 }}
                />
              ) : null}
              <Icon className="size-4.5 shrink-0" />
              <AnimatePresence initial={false}>
                {!compact ? (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="truncate font-medium"
                  >
                    {item.label}
                  </motion.span>
                ) : null}
              </AnimatePresence>
            </Link>
          );
        })}
      </nav>

      <ProfileFooter compact={compact} onNavigate={onNavigate} />
    </div>
  );
}

/* ---------------------------------------------------------------- profile */

function ProfileFooter({ compact, onNavigate }: { compact: boolean; onNavigate?: () => void }) {
  const displayName = useSession((s) => s.displayName);
  const email = useSession((s) => s.email);
  const role = useSession((s) => s.role);

  return (
    <div
      className={cn(
        'mt-auto flex items-center gap-3 border-t border-line px-4 py-4',
        compact && 'flex-col gap-2 px-2'
      )}
    >
      <Initials name={displayName || email || 'Admin'} size="sm" />
      {!compact ? (
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-mist-200">
            {displayName || email || 'Signed in'}
          </p>
          <div className="mt-1">
            <RoleBadge role={role} />
          </div>
        </div>
      ) : null}
      <button
        onClick={() => {
          onNavigate?.();
          void signOut();
        }}
        aria-label="Sign out"
        title="Sign out"
        className={cn(
          'rounded-lg p-2 text-mist-600 transition-colors hover:bg-signal-rose/10 hover:text-signal-rose',
          compact && 'p-1.5'
        )}
      >
        <LogOut className="size-4" />
      </button>
    </div>
  );
}

/* --------------------------------------------------------------- sidebar */

export function Sidebar() {
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const mobileOpen = useUi((s) => s.mobileNavOpen);
  const setMobile = useUi((s) => s.setMobileNav);

  return (
    <>
      {/* Desktop rail */}
      <motion.aside
        initial={false}
        animate={{ width: collapsed ? 84 : 264 }}
        transition={{ type: 'spring', stiffness: 340, damping: 36 }}
        className="fixed inset-y-0 left-0 z-40 hidden border-r border-line bg-ink-900/70 backdrop-blur-xl md:block"
      >
        <Rail compact={collapsed} />
      </motion.aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen ? (
          <motion.div
            key="mobile-nav"
            className="fixed inset-0 z-50 md:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div
              className="absolute inset-0 bg-black/65 backdrop-blur-sm"
              onClick={() => setMobile(false)}
            />
            <motion.div
              initial={{ x: -300 }}
              animate={{ x: 0 }}
              exit={{ x: -300 }}
              transition={{ type: 'spring', stiffness: 380, damping: 38 }}
              className="absolute inset-y-0 left-0 w-[272px] border-r border-line bg-ink-900"
            >
              <button
                onClick={() => setMobile(false)}
                aria-label="Close navigation"
                className="absolute right-3 top-4 rounded-lg p-2 text-mist-600 hover:text-mist-200"
              >
                <X className="size-4" />
              </button>
              <Rail overlay compact={false} onNavigate={() => setMobile(false)} />
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}