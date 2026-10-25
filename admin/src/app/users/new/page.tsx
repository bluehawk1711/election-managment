'use client';

/**
 * New account — the invite flow: Firebase Auth user + `users/{uid}` profile,
 * created together with a rollback in `createAccount` (see its header).
 *
 * The form mirrors what `mobile/app/(tabs)/more/users/new.tsx` sends so both
 * surfaces produce byte-identical profile documents — the same rules, the
 * same keys, the same ward invariant (the wardNo/wardNos keys are SENT only
 * for a karykarta, ABSENT for everyone else — rules reject presence for a
 * non-karykarta, not just a nonzero value). A karykarta takes ONE OR MORE
 * wards, entered comma-separated below; `createAccount` stores wardNo as the
 * first of the set and wardNos as the full map.
 */
import { ArrowLeft, Loader2, ShieldCheck, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { createAccount } from '@/lib/api';
import { APP_ROLES, can, roleLabel, type AppRole } from '@/lib/roles';
import { messageFor, toast } from '@/stores/toast';
import { MotionPage } from '@/components/shell/motion-page';
import { Button, Field, Input, Panel, Select } from '@/components/ui/kit';
import { useSession } from '@/stores/session';

/**
 * The ward field: one or more ward numbers separated by commas, spaces or
 * any other non-digit. Deduped, validated against the rules' 1..999 ceiling
 * and sorted ascending — the exact shape `createAccount` normalises and
 * writes as `wardNo` (the first ward) + `wardNos` (the full map).
 */
const parseWards = (text: string): number[] =>
  [
    ...new Set(
      text
        .split(/[^\d]+/)
        .filter(Boolean)
        .map(Number)
        .filter((wardNo) => wardNo >= 1 && wardNo <= 999)
    ),
  ].sort((a, b) => a - b);

export default function NewAccountPage() {
  const router = useRouter();
  const myRole = useSession((s) => s.role);

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<AppRole>('karykarta');
  const [wards, setWards] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canManage = can(myRole, 'accountManage');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;

    if (!displayName.trim()) {
      setError('A display name is required — the team sees it on proposals and tasks.');
      return;
    }
    if (role === 'karykarta' && parseWards(wards).length === 0) {
      setError('A karykarta needs at least one ward number above 0.');
      return;
    }
    if (password.length < 6) {
      setError('Passwords must be at least 6 characters (Firebase Auth’s floor).');
      return;
    }

    setBusy(true);
    setError(null);
    const ok = await createAccount({
      email: email.trim(),
      password,
      displayName: displayName.trim(),
      role,
      wardNos: role === 'karykarta' ? parseWards(wards) : null,
    }).then(
      () => true,
      (caught: unknown) => {
        setError(messageFor(caught));
        return false;
      }
    );

    setBusy(false);
    if (ok) {
      toast.success(
        'Account created',
        `${email.trim()} can sign in immediately as ${roleLabel(role)}.`
      );
      router.push('/users');
    }
  };

  if (!canManage) {
    return (
      <MotionPage>
        <Panel className="p-8 text-center">
          <ShieldCheck className="mx-auto size-6 text-mist-600" />
          <p className="mt-3 text-sm font-medium text-mist-200">
            Creating accounts needs super admin or developer
          </p>
          <Link href="/users" className="mt-3 inline-block text-xs text-brand-400 hover:underline">
            Back to the roster
          </Link>
        </Panel>
      </MotionPage>
    );
  }

  return (
    <MotionPage className="mx-auto max-w-[560px] space-y-5">
      <div className="flex items-center gap-3">
        <Link
          href="/users"
          aria-label="Back to accounts"
          className="rounded-lg border border-line bg-white/[0.03] p-2 text-mist-400 transition-colors hover:text-mist-50"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-mist-50">New account</h2>
          <p className="text-sm text-mist-400">
            Auth user + profile, created together — a failure rolls the Auth record back so a
            retry just works.
          </p>
        </div>
      </div>

      <Panel className="p-6">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Display name">
            <Input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Ramesh Kumawat"
              autoComplete="off"
            />
          </Field>

          <Field label="Email">
            <Input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="ramesh@campaign.in"
              autoComplete="off"
            />
          </Field>

          <Field label="Temporary password" hint="At least 6 characters — share it out of band; the owner changes it later.">
            <Input
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••"
              autoComplete="new-password"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Role">
              <Select
                value={role}
                onChange={(event) => setRole(event.target.value as AppRole)}
              >
                {APP_ROLES.map((value) => (
                  <option key={value} value={value}>
                    {roleLabel(value)}
                  </option>
                ))}
              </Select>
            </Field>

            <div className={role === 'karykarta' ? '' : 'pointer-events-none opacity-40'}>
              <Field
                label="Wards (karykarta)"
                hint={
                  role === 'karykarta'
                    ? 'One or more, comma-separated — e.g. 3, 5, 7. Required for this role.'
                    : 'Only karykarta are ward-scoped.'
                }
              >
                <Input
                  value={wards}
                  onChange={(event) => setWards(event.target.value)}
                  placeholder={role === 'karykarta' ? 'e.g. 3, 5, 7' : '—'}
                  disabled={role !== 'karykarta'}
                />
              </Field>
            </div>
          </div>

          {error ? (
            <p
              className="shake rounded-lg border border-signal-rose/30 bg-signal-rose/10 px-3 py-2 text-xs leading-relaxed text-signal-rose"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-2.5 pt-1">
            <Link href="/users">
              <Button variant="ghost" disabled={busy}>
                Cancel
              </Button>
            </Link>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Creating…
                </>
              ) : (
                <>
                  <UserPlus className="size-4" />
                  Create account
                </>
              )}
            </Button>
          </div>
        </form>
      </Panel>
    </MotionPage>
  );
}