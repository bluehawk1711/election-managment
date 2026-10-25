'use client';

/**
 * The client shell's wiring, in dependency order:
 *
 *  1. `QueryClientProvider` — the live-query cache (hooks/use-live.ts).
 *  2. `SessionEffect` — mounts ONCE: `onAuthStateChanged` switches identities
 *     and attaches an RTDB listener to `users/{uid}`; results land in the
 *     Zustand session store. A role granted by another super admin therefore
 *     re-renders the control that just became (un)available — privilege
 *     changes are snapshotted, never refetched-and-hoped.
 *  3. `Gate` — the route guard. Firebase's client SDK cannot run on the
 *     server, so this is deliberately client-side: loading shows a boot
 *     screen, anon renders `/login` (and rewrites any other path), signed-in
 *     on `/login` bounces home, signed-in pages get `<AppShell>`. A plain
 *     `admin` is pinned to `/voters` here as well as in the sidebar — a deep
 *     link to `/users` must not mount the account screen just because the
 *     nav hid the link.
 *  4. `Toaster` — one host for stores/toast.ts messages.
 *
 * No middleware: `middleware.ts` cannot await Firebase client auth (no
 * IndexedDB, no session tokens on the edge), and a server session layer would
 * mean a second auth system to keep in sync. The trade is one redirect
 * round-trip on a cold visit to a protected URL — which the gate covers
 * before any app chrome paints.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { onAuthStateChanged } from 'firebase/auth';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, type ReactNode } from 'react';
import { onDoc } from '@/lib/db';
import { auth } from '@/lib/firebase';
import { enforceDeviceLock } from '@/lib/device-lock';
import { canOpenPanelRoute, panelHome } from '@/lib/roles';
import { AppShell } from '@/components/shell/app-shell';
import { Toaster } from '@/components/ui/toaster';
import { useSession } from '@/stores/session';

function SessionEffect() {
  useEffect(() => {
    let detachProfile: (() => void) | undefined;

    const detachAuth = onAuthStateChanged(auth, (user) => {
      detachProfile?.();
      detachProfile = undefined;

      if (!user) {
        useSession.getState().signOut();
        return;
      }

      useSession.getState().signIn({
        uid: user.uid,
        email: user.email ?? '',
        displayName: user.displayName ?? '',
      });

      detachProfile = onDoc(
        `users/${user.uid}`,
        (snapshot) => {
          const data = snapshot.exists()
            ? (snapshot.data() as Record<string, unknown>)
            : null;

          // The full assigned ward set: the `wardNos` map when present,
          // falling back to the single legacy `wardNo` — so `session.wardNos`
          // is ALWAYS the complete scope and consumers need only it. The map
          // is `{ "3": true, "7": true }` (written by grantRole / applyProfile
          // in lib/api.ts); keys are coerced to sorted numbers, and an empty
          // or malformed map degrades to the single ward rather than to "no
          // scope", because a karykarta's `wardNo` is authoritative on its own.
          const wardNos = (() => {
            if (!data) return null;
            if (
              data.wardNos &&
              typeof data.wardNos === 'object' &&
              !Array.isArray(data.wardNos)
            ) {
              const wards = Object.keys(data.wardNos as Record<string, unknown>)
                .filter((key) => /^[1-9][0-9]{0,2}$/.test(key))
                .map(Number)
                .sort((a, b) => a - b);
              if (wards.length > 0) return wards;
            }
            return typeof data.wardNo === 'number' ? [data.wardNo] : null;
          })();

          useSession.getState().applyProfile({
            // No `users` document at all reads as roleless — which is exactly
            // what the rules enforce for every path this uid could take. The
            // UI and the server agree on the same 'nothing is permitted'.
            role: data && typeof data.role === 'string' ? data.role : null,
            wardNo: data && typeof data.wardNo === 'number' ? data.wardNo : null,
            wardNos,
            onboarded: data?.onboarded === true,
            displayName:
              data && typeof data.displayName === 'string' && data.displayName
                ? data.displayName
                : undefined,
          });

          // Per-device lock, on every snapshot: already locked → sign out;
          // bound to ANOTHER browser → lock the account + sign out; no
          // binding yet → bind THIS one. See lib/device-lock.ts for the
          // three-state walk — it mirrors mobile's auth provider exactly.
          void enforceDeviceLock(user.uid, data).catch(() => undefined);
        },
        (error) => {
          // Terminal listener errors are credential-class (the missing-doc
          // case always emits through the snapshot path instead). Sign out
          // rather than render a half-session.
          console.error('[session] profile listener failed', error);
          useSession.getState().signOut();
        }
      );
    });

    return () => {
      detachAuth?.();
      detachProfile?.();
    };
  }, []);

  return null;
}

function Boot() {
  return (
    <div className="grid min-h-screen place-items-center">
      <div className="flex flex-col items-center gap-4">
        <div className="brand-gradient h-11 w-11 rounded-xl shadow-[0_10px_40px_-12px_rgb(99_102_241/0.7)]" />
        <p className="text-sm text-mist-400">Waking the console…</p>
      </div>
    </div>
  );
}

function NoAccess() {
  return (
    <div className="grid min-h-screen place-items-center px-6">
      <div className="panel edge-lit max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold">Signed out</h1>
        <p className="mt-2 text-sm text-mist-400">
          Your session ended or was never established. Sign in again to reach
          the console.
        </p>
        <Link
          href="/login"
          className="brand-gradient mt-6 inline-flex rounded-lg px-5 py-2.5 text-sm font-medium"
        >
          Go to sign in
        </Link>
      </div>
    </div>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  // One QueryClient per mounted tree (StrictMode-safe: useMemo over render).
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Live listeners own freshness; mutations own invalidation.
            staleTime: Infinity,
            gcTime: 10 * 60 * 1000,
            retry: false,
            refetchOnWindowFocus: false,
          },
          mutations: { retry: false },
        },
      }),
    []
  );

  const status = useSession((s) => s.status);
  const role = useSession((s) => s.role);
  const profileReady = useSession((s) => s.profileReady);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (status === 'anon') {
      if (pathname !== '/login') router.replace('/login');
      return;
    }
    // Wait for the profile before routing on `role`: at sign-in the auth
    // listener fires before the `users/{uid}` snapshot, so acting early would
    // send an admin to `/` and only then discover they belong on `/voters`.
    if (status !== 'ready' || !profileReady) return;

    if (pathname === '/login') {
      router.replace(panelHome(role));
      return;
    }
    if (!canOpenPanelRoute(role, pathname)) {
      router.replace(panelHome(role));
    }
  }, [status, profileReady, role, pathname, router]);

  let view: ReactNode;
  if (status === 'loading' || (status === 'ready' && !profileReady)) {
    view = <Boot />;
  } else if (status === 'anon') {
    view = pathname === '/login' ? children : <NoAccess />;
  } else if (pathname === '/login' || !canOpenPanelRoute(role, pathname)) {
    // Signed in but parked on /login or a route this role may not open — one
    // frame of the boot screen while the replacement navigation runs. Keeping
    // the page from mounting is the point: a hidden nav link is not a guard.
    view = <Boot />;
  } else {
    view = <AppShell>{children}</AppShell>;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <SessionEffect />
      {view}
      <Toaster />
    </QueryClientProvider>
  );
}