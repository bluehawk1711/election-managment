'use client';

/**
 * Settings — the release gate and the support line.
 *
 * Two numbers live in `appConfig/general`, read by EVERY mobile build on
 * launch (firestore.rules gives that doc an unauthenticated read on purpose:
 * an outdated build must be able to see why it is locked, even on the
 * sign-in screen):
 *
 *  - `requiredVersion` — the hard line. The app compares its own
 *    `expoConfig.version` against this with a semver-less numeric compare;
 *    anything below renders NOTHING but the update modal, whose button opens
 *    WhatsApp at `supportPhone` with a pre-written "I need the new update"
 *    message. Raising this line locks every already-installed build that has
 *    not been updated — which is exactly why saving it sits behind
 *    `canManageAccounts` (super admin + developer) server-side
 *    (`firestore.rules §appConfig`) while the form below re-checks the same
 *    capability with `can()`.
 *  - `latestVersion` — informational (shown here, offered to builds that are
 *    old but not YET locked) — and `supportPhone`, digits only with the
 *    country code — `wa.me/919876543210`, not `+91…`.
 *
 * The same Save writes all five keys because the rule demands the exact key
 * set on every write — a partial "save one field" would be a rejected
 * update, not a merge.
 */
import { LifeBuoy, Loader2, Rocket, Save, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { readAppConfig, saveAppConfig } from '@/lib/api';
import { can } from '@/lib/roles';
import { messageFor, toast } from '@/stores/toast';
import { useSession } from '@/stores/session';
import { MotionPage } from '@/components/shell/motion-page';
import {
  Button,
  EmptyState,
  Field,
  Input,
  Panel,
  Skeleton,
} from '@/components/ui/kit';

/** Deliberately loose — firestore.rules enforces the same shape server-side. */
const SEMVER = /^\d+(\.\d+){0,3}([-.][A-Za-z0-9.-]+)?$/;
const PLAIN_SEMVER = /^\d+(\.\d+)*$/;
const PHONE = /^\d{0,15}$/;

/** Numeric segment compare: `1.10.0` > `1.9.0` (string compare would not be). */
function compareVersions(a: string, b: string): number {
  const left = a.split(/[.-]/)[0].split('.').map(Number);
  const right = b.split(/[.-]/)[0].split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export default function SettingsPage() {
  const role = useSession((s) => s.role);
  const myUid = useSession((s) => s.uid);
  const allowed = can(role, 'accountManage');

  const [latest, setLatest] = useState('');
  const [required, setRequired] = useState('');
  const [phone, setPhone] = useState('');
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [updatedBy, setUpdatedBy] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<'gate' | 'support' | null>(null);
  const [gateError, setGateError] = useState<string | null>(null);
  const [supportError, setSupportError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Async read, async setState — the promise resolution keeps this legal
    // (a synchronous setState in the effect body is the cascading render
    // react-hooks/refs warns about; this is not that).
    readAppConfig()
      .then((config) => {
        if (cancelled || !config) return;
        setLatest(config.latestVersion);
        setRequired(config.requiredVersion);
        setPhone(config.supportPhone);
        setUpdatedAt(config.updatedAt || null);
        setUpdatedBy(config.updatedBy);
      })
      .catch((caught) => toast.error('Could not read settings', messageFor(caught)))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = async (which: 'gate' | 'support') => {
    if (!myUid) return;
    setGateError(null);
    setSupportError(null);

    if (!SEMVER.test(latest)) {
      setGateError('Latest version must look like 1, 1.0 or 1.2.3.');
      return;
    }
    if (!PLAIN_SEMVER.test(required)) {
      setGateError('Required version must be plain numbers: 1, 1.0, 1.2.3 (no suffix).');
      return;
    }
    if (compareVersions(required, latest) > 0) {
      setGateError('Required version cannot be HIGHER than the latest version.');
      return;
    }
    if (!PHONE.test(phone.replace(/\D/g, ''))) {
      setSupportError('Digits only, 6–15 long, country code without "+".');
      return;
    }

    setSaving(which);
    try {
      await saveAppConfig(
        {
          latestVersion: latest.trim(),
          requiredVersion: required.trim(),
          supportPhone: phone.replace(/\D/g, ''),
        },
        myUid
      );
      setUpdatedAt(Date.now());
      setUpdatedBy(myUid);
      toast.success(
        which === 'gate' ? 'Release gate saved' : 'Support line saved',
        which === 'gate'
          ? `Builds below ${required.trim()} are now locked behind the update modal.`
          : phone.trim()
            ? `The Update button opens WhatsApp at +${phone.replace(/\D/g, '')}.`
            : 'Support line cleared — the update modal shows the message without a chat link.'
      );
    } catch (caught) {
      toast.error('Save refused', messageFor(caught));
    } finally {
      setSaving(null);
    }
  };

  if (!allowed) {
    return (
      <MotionPage>
        <Panel>
          <EmptyState
            icon={<ShieldCheck className='size-5' />}
            title='Settings need account management'
            detail='The release gate locks every installed build below it, so it lives with canManageAccounts — super admin and developer only. The mobile rules re-check exactly that word on save.'
            action={
              <Link href='/' className='text-xs text-brand-400 underline-offset-4 hover:underline'>
                Back to overview
              </Link>
            }
          />
        </Panel>
      </MotionPage>
    );
  }

  const waNumber = phone.replace(/\D/g, '');

  return (
    <MotionPage className='space-y-5'>
      <div>
        <h2 className='text-xl font-semibold tracking-tight text-mist-50'>Settings</h2>
        <p className='text-sm text-mist-400'>
          Release gate and support line — both read by the mobile app the moment it opens.
          {updatedAt ? ` Last saved ${new Date(updatedAt).toLocaleString('en-IN')}.` : ''}
        </p>
      </div>

      <div className='grid gap-5 lg:grid-cols-2'>
        {/* ------------------------------------------------ release gate -- */}
        <Panel className='p-6'>
          <div className='flex items-center gap-3'>
            <span className='brand-gradient grid size-10 place-items-center rounded-xl'>
              <Rocket className='size-5 text-white' />
            </span>
            <div>
              <h3 className='text-[15px] font-semibold text-mist-50'>App version gate</h3>
              <p className='text-xs text-mist-600'>
                A build below <strong>required</strong> cannot be used at all — it shows the
                update lock until it is updated.
              </p>
            </div>
          </div>

          {loading ? (
            <div className='mt-5 space-y-3'>
              <Skeleton className='h-10' />
              <Skeleton className='h-10' />
            </div>
          ) : (
            <div className='mt-5 space-y-4'>
              <div className='grid gap-4 sm:grid-cols-2'>
                <Field
                  label='Latest version'
                  hint='What you just shipped. Informational.'
                >
                  <Input
                    value={latest}
                    onChange={(event) => setLatest(event.target.value)}
                    placeholder='1.2.0'
                    inputMode='decimal'
                  />
                </Field>
                <Field
                  label='Required version'
                  hint='Hard floor. Save this AFTER rolling the update out.'
                >
                  <Input
                    value={required}
                    onChange={(event) => setRequired(event.target.value)}
                    placeholder='1.1.0'
                    inputMode='decimal'
                  />
                </Field>
              </div>

              {gateError ? (
                <p className='rounded-lg border border-signal-rose/30 bg-signal-rose/10 px-3 py-2 text-xs text-signal-rose'>
                  {gateError}
                </p>
              ) : null}

              <p className='rounded-lg border border-line bg-white/[0.02] px-3 py-2 text-[11px] leading-relaxed text-mist-500'>
                The app reports its own version from <code>app.json → version</code>. Comparison
                is numeric per segment (<code>1.10.0</code> &gt; <code>1.9.0</code>). Locking a
                build does not remove data — it is a modal over the whole app until the update
                arrives.
              </p>

              <div className='flex justify-end'>
                <Button variant='primary' onClick={() => void persist('gate')} disabled={saving !== null}>
                  {saving === 'gate' ? (
                    <Loader2 className='size-4 animate-spin' />
                  ) : (
                    <Save className='size-4' />
                  )}
                  Save gate
                </Button>
              </div>
            </div>
          )}
        </Panel>

        {/* --------------------------------------------- support line --- */}
        <Panel className='p-6'>
          <div className='flex items-center gap-3'>
            <span className='grid size-10 place-items-center rounded-xl border border-line bg-white/[0.03]'>
              <LifeBuoy className='size-5 text-signal-emerald' />
            </span>
            <div>
              <h3 className='text-[15px] font-semibold text-mist-50'>WhatsApp support line</h3>
              <p className='text-xs text-mist-600'>
                The number the update modal's button opens, with a pre-written request.
              </p>
            </div>
          </div>

          {loading ? (
            <div className='mt-5 space-y-3'>
              <Skeleton className='h-10' />
            </div>
          ) : (
            <div className='mt-5 space-y-4'>
              <Field
                label='Number (country code, digits only)'
                hint='Example: 919876543210 → wa.me/919876543210. Leave empty to hide the chat link.'
              >
                <Input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value.replace(/\D/g, ''))}
                  placeholder='919876543210'
                  inputMode='numeric'
                  maxLength={15}
                />
              </Field>

              {supportError ? (
                <p className='rounded-lg border border-signal-rose/30 bg-signal-rose/10 px-3 py-2 text-xs text-signal-rose'>
                  {supportError}
                </p>
              ) : null}

              <div className='rounded-lg border border-line bg-white/[0.02] px-3 py-2 text-[11px] leading-relaxed text-mist-500'>
                <span className='text-mist-400'>Preview:</span>{' '}
                {waNumber ? (
                  <span className='text-brand-400'>
                    https://wa.me/{waNumber}?text=…
                  </span>
                ) : (
                  <span>no number — the modal shows the written message only</span>
                )}
                <br />
                Message: “Hi, I need the new update of the app {latest ? `(version ${latest})` : ''}.”
              </div>

              <div className='flex justify-end'>
                <Button variant='primary' onClick={() => void persist('support')} disabled={saving !== null}>
                  {saving === 'support' ? (
                    <Loader2 className='size-4 animate-spin' />
                  ) : (
                    <Save className='size-4' />
                  )}
                  Save line
                </Button>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </MotionPage>
  );
}