'use client';

/**
 * The topbar — a fixed glass strip: mobile nav trigger, the current page's
 * title (derived from the path, so a deep link says where you landed), and on
 * the right the two facts an admin wants at a glance: the data behind this
 * page is a LIVE Realtime Database snapshot (pulsing dot — truthful, every
 * list on the panel is a standing `onValue` subscription), and who you are
 * signed in as.
 */
import { Menu } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useSession } from '@/stores/session';
import { useUi } from '@/stores/ui';
import { Initials, RoleBadge } from '@/components/ui/kit';

function titleFor(pathname: string): { title: string; section: string } {
  if (pathname === '/') return { title: 'Overview', section: 'Dashboard' };
  if (pathname === '/voters') return { title: 'Voter roll', section: 'Field data' };
  if (pathname.startsWith('/voters/')) return { title: 'Voter detail', section: 'Field data' };
  if (pathname === '/changes') return { title: 'Voter changes', section: 'Field data' };
  if (pathname === '/users') return { title: 'Accounts', section: 'Team' };
  if (pathname === '/users/new') return { title: 'New account', section: 'Team' };
  if (pathname === '/tasks') return { title: 'Tasks', section: 'Operations' };
  return { title: 'Campaign HQ', section: 'Console' };
}

export function Topbar() {
  const pathname = usePathname();
  const setMobile = useUi((s) => s.setMobileNav);
  const displayName = useSession((s) => s.displayName);
  const email = useSession((s) => s.email);
  const role = useSession((s) => s.role);
  const { title, section } = titleFor(pathname);

  return (
    <header className="glass sticky top-0 z-30 flex h-16 items-center gap-4 px-4 md:px-8">
      <button
        onClick={() => setMobile(true)}
        aria-label="Open navigation"
        className="rounded-lg p-2 text-mist-400 transition-colors hover:bg-white/5 hover:text-mist-50 md:hidden"
      >
        <Menu className="size-5" />
      </button>

      <div className="min-w-0">
        <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-mist-600">
          {section}
        </p>
        <h1 className="truncate text-[15px] font-semibold leading-tight text-mist-50">
          {title}
        </h1>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <span className="hidden items-center gap-1.5 rounded-full border border-line bg-white/[0.03] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-signal-emerald sm:inline-flex">
          <span className="live-dot size-1.5 rounded-full bg-signal-emerald" />
          Live
        </span>

        <div className="flex items-center gap-2.5 rounded-full border border-line bg-white/[0.03] py-1 pl-1 pr-3">
          <Initials name={displayName || email || 'Admin'} size="sm" />
          <div className="hidden flex-col items-start leading-none sm:flex">
            <span className="max-w-[140px] truncate text-xs font-medium text-mist-200">
              {displayName || email || 'Signed in'}
            </span>
            <span className="mt-1">
              <RoleBadge role={role} />
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}