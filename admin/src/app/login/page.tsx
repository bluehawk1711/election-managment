'use client';

/**
 * Sign-in — the only route rendered outside the app shell.
 *
 * A wrong password or a locked account shakes the CARD while the message
 * fades in beneath the fields: motion that reports which interaction failed,
 * not sparkle. Session handoff is the session store's problem — once Firebase
 * flips to signed-in, `providers.tsx`'s gate navigates away from here, which
 * is why this form calls the API and forgets it rather than routing itself.
 */
import { motion } from 'motion/react';
import { AlertTriangle, Eye, EyeOff, Loader2, Lock, Mail, Vote } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { signIn } from '@/lib/api';
import { clearLockNotice, readLockNotice, type LockReason } from '@/lib/device-lock';
import { messageFor } from '@/stores/toast';
import { Button, Field, Input } from '@/components/ui/kit';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  // Why the last session ended in a lock-out — written by the device-lock
  // enforcement in lib/device-lock.ts across the sign-out it just performed,
  // so the person who retries from this browser is told WHY it will fail
  // instead of guessing. Read in the state INITIALIZER (one render, no
  // effect — a setState inside an effect would re-render just to learn a
  // value localStorage already had).
  const [lockReason] = useState<LockReason | null>(() =>
    typeof window === 'undefined' ? null : (readLockNotice()?.reason ?? null)
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      await signIn(email.trim(), password);
      // The stale lockout is behind us — a SUCCESSFUL sign-in means the
      // account is unbound/unlocked for this browser (otherwise the session
      // effect locks it out again and rewrites the notice).
      clearLockNotice();
      // The gate in providers.tsx takes over — it watches the session store.
      router.replace('/');
    } catch (caught) {
      setError(messageFor(caught));
      // Re-key so the shake replays on EVERY failure, not only the first.
      setShakeKey((key) => key + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center px-4">
      {/* Ambient brand glow behind the card */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            'radial-gradient(560px 320px at 50% 38%, rgb(99 102 241 / 0.16), transparent 70%)',
        }}
      />

      <motion.div
        key={shakeKey}
        initial={{ opacity: 0, y: 18, scale: 0.985 }}
        animate={
          error
            ? { opacity: 1, y: 0, scale: 1, transition: { type: 'tween' } }
            : { opacity: 1, y: 0, scale: 1 }
        }
        className={`panel edge-lit relative z-10 w-full max-w-[400px] p-8 ${
          error ? 'shake' : ''
        }`}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="flex flex-col items-center text-center">
          <span className="brand-gradient grid size-12 place-items-center rounded-2xl shadow-[0_14px_44px_-14px_rgb(99_102_241/0.9)]">
            <Vote className="size-6 text-white" />
          </span>
          <h1 className="brand-text mt-4 text-xl font-semibold">Campaign HQ</h1>
          <p className="mt-1 text-xs text-mist-600">
            Sign in with the account a super admin created for you.
          </p>
        </div>

        <form onSubmit={submit} className="mt-7 space-y-4">
          {lockReason ? (
            <div className="rounded-lg border border-signal-rose/30 bg-signal-rose/10 p-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="size-4 shrink-0 text-signal-rose" />
                <p className="text-xs font-semibold text-signal-rose">
                  {lockReason === 'device_change'
                    ? 'Account locked — opened on another device'
                    : 'Account locked by an administrator'}
                </p>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-mist-400">
                {lockReason === 'device_change'
                  ? 'This account is bound to one browser/device. Opening the console from a second one locked it. The super admin must unlock it — the binding is then cleared and this browser re-binds on the next sign-in.'
                  : 'A super admin locked this account. Only they can unlock it, so contact your administrator before retrying.'}
              </p>
            </div>
          ) : null}
          <Field label="Email">
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-mist-600" />
              <Input
                type="email"
                autoComplete="email"
                required
                placeholder="you@campaign.in"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="pl-10"
              />
            </div>
          </Field>

          <Field label="Password">
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-mist-600" />
              <Input
                type={reveal ? 'text' : 'password'}
                autoComplete="current-password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="pl-10 pr-10"
              />
              <button
                type="button"
                onClick={() => setReveal((value) => !value)}
                aria-label={reveal ? 'Hide password' : 'Show password'}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-mist-600 hover:text-mist-200"
              >
                {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </Field>

          {error ? (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-lg border border-signal-rose/30 bg-signal-rose/10 px-3 py-2 text-xs leading-relaxed text-signal-rose"
              role="alert"
            >
              {error}
            </motion.p>
          ) : null}

          <Button
            type="submit"
            variant="primary"
            disabled={busy}
            className="w-full py-2.5"
          >
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Signing in…
              </>
            ) : (
              'Sign in'
            )}
          </Button>
        </form>

        <p className="mt-6 text-center text-[11px] leading-relaxed text-mist-600">
          No account? A super admin invites you from <strong>Accounts</strong> in this console —
          or from the mobile app&apos;s More → Accounts screen.
        </p>
      </motion.div>
    </div>
  );
}