'use client';

/**
 * The voter slide-over — corrections form on top, team phone board below.
 *
 * Two writes, two rule paths, one drawer:
 *
 * 1. **Corrections** → `users/{myUid}/voterEdits/{voterId}` — the signed-in
 *    account's PRIVATE overlay (the same document the mobile sync pushes).
 *    The form diffs against the CURRENT overlay at save time and only sends
 *    keys that actually moved; clearing a field back to the roll's value is a
 *    `deleteField()` (the RESULT then lacks the key, which the rules' key
 *    allowlist reads as "still legal"), never `''`, because `viewOf`'s `??`
 *    fallback only wakes up when the key is truly gone.
 *
 * 2. **Phone board** → `voterPhones/{voterId}` (+ `/proposals/{uid}`) — every
 *    role that can read the roll may propose; only `contactFinalize` may put a
 *    number IN USE, and that write always sends the full five-key document
 *    because the rule uses `exactKeys` on the result.
 *
 * Motion is load-bearing: the sheet slides from the right edge (where the row
 * was clicked), Escape cancels, the backdrop cancels — and the corrections
 * form RESETS its seed on `row.id` only, so a background overlay snapshot
 * arriving mid-typing can never yank form state out from under the caret.
 */
import { deleteField } from 'firebase/firestore';
import { AnimatePresence, motion } from 'motion/react';
import {
  Check,
  Info,
  Loader2,
  MessageCircle,
  Phone,
  RotateCcw,
  Save,
  ShieldCheck,
  Star,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  boardRef,
  buildProposalsQuery,
  finalizePhone,
  proposePhone,
  saveVoterPatch,
  subscribeDocOrNull,
} from '@/lib/api';
import { boardFromDoc, proposalFromDoc } from '@/lib/mappers';
import {
  activePhone,
  groupProposals,
  isValidPhone,
  phoneKey,
  type FinalizedContact,
  type PhoneProposal,
} from '@/lib/contacts';
import { can } from '@/lib/roles';
import { messageFor, toast } from '@/stores/toast';
import { e164, telUrl, whatsappUrl } from '@/lib/contact';
import { cn, formatAgo, formatWhen } from '@/lib/util';
import type {
  Gender,
  Leaning,
  VoterOverlay,
  VoterRow,
  VotedStatus,
} from '@/lib/types';
import { subscribeCollectionOf, useLiveQuery } from '@/hooks/use-live';
import {
  Button,
  Field,
  Input,
  Panel,
  Select,
  Skeleton,
  Textarea,
} from '@/components/ui/kit';
import { useSession } from '@/stores/session';

/* --------------------------------------------------------------- forms -- */

interface FormState {
  name: string;
  father: string;
  houseNo: string;
  age: string;
  gender: Gender;
  locality: string;
  jati: string;
  phone: string;
  voted: VotedStatus;
  leaning: Leaning;
  leaningNote: string;
  note: string;
}

function seedFrom(row: VoterRow, overlay: VoterOverlay | null): FormState {
  const o = overlay ?? ({} as VoterOverlay);
  const effAge = o.age ?? row.age;
  return {
    name: o.name ?? row.name,
    father: o.fatherOrHusbandName ?? row.fatherOrHusbandName,
    houseNo: o.houseNo ?? row.houseNo,
    age: String(effAge),
    gender: o.gender ?? row.gender,
    locality: o.locality ?? row.locality,
    jati: o.jati ?? '',
    phone: o.phone ?? '',
    voted: o.voted ?? 'unknown',
    leaning: o.leaning ?? 'unknown',
    leaningNote: o.leaningNote ?? '',
    note: o.note ?? '',
  };
}

const GENDERS: Gender[] = ['male', 'female', 'other'];
const VOTED: VotedStatus[] = ['unknown', 'voted', 'notVoted'];
const LEANINGS: Leaning[] = ['unknown', 'right', 'centerRight', 'center', 'centerLeft', 'left'];

/* --------------------------------------------------------------- drawer -- */

export function VoterDrawer({
  row,
  overlay,
  onClose,
}: {
  row: VoterRow;
  overlay: VoterOverlay | null;
  onClose: () => void;
}) {
  const uid = useSession((s) => s.uid);
  const role = useSession((s) => s.role);
  const displayName = useSession((s) => s.displayName);
  const email = useSession((s) => s.email);

  /* ---- form ---- */
  const [form, setForm] = useState<FormState>(() => seedFrom(row, overlay));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Re-seed on voter change ONLY (see the file header). The overlay prop is
  // live, so keying on it would clobber in-flight typing.
  useEffect(() => {
    setForm(seedFrom(row, overlay));
    setFormError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((state) => ({ ...state, [key]: value }));

  /* ---- live board ---- */
  const boardQuery = useLiveQuery<FinalizedContact | null>({
    key: ['board', row.id],
    subscribe: ({ emit, fail }) =>
      subscribeDocOrNull<FinalizedContact>(
        boardRef(row.id),
        boardFromDoc,
        emit,
        fail
      ),
  });

  const proposalsQuery = useLiveQuery<PhoneProposal[]>({
    key: ['proposals', row.id],
    subscribe: ({ emit, fail }) =>
      subscribeCollectionOf(
        buildProposalsQuery(row.id),
        proposalFromDoc,
        emit,
        fail
      ),
  });

  const board = boardQuery.data ?? null;
  const proposals = proposalsQuery.data ?? [];
  const groups = useMemo(
    () => groupProposals(proposals, board?.finalPhone),
    [proposals, board?.finalPhone]
  );

  const canFinalize = can(role, 'contactFinalize');
  // A karykarta may only propose inside their assigned ward SET: `wardNos`
  // is the complete scope (normalised by providers.tsx), with `wardNo` kept
  // as a fallback so a legacy profile — a `wardNos` map not written yet —
  // still matches its single ward. Empty set ⇒ no ward, i.e. fail closed.
  const { wardNo, wardNos } = useSession.getState();
  const assignedWards = wardNos ?? (wardNo != null ? [wardNo] : []);
  const canPropose =
    can(role, 'voterEdit') &&
    (role !== 'karykarta' || assignedWards.includes(row.wardNo));

  const activeNum = activePhone(board?.finalPhone, overlay?.phone);

  /* ---- propose ---- */
  const [proposing, setProposing] = useState(false);
  const [proposalPhone, setProposalPhone] = useState('');
  const [proposalError, setProposalError] = useState<string | null>(null);

  const submitProposal = async () => {
    if (!uid || proposing) return;
    if (!isValidPhone(proposalPhone)) {
      setProposalError('Enter a valid number — digits, 6 to 15 of them (+ country code allowed).');
      return;
    }
    setProposalError(null);
    setProposing(true);
    try {
      await proposePhone({
        uid,
        voter: row,
        phone: proposalPhone,
        authorName: displayName || email.split('@')[0] || 'Unknown',
      });
      setProposalPhone('');
      toast.success('Number proposed', 'Everyone on the team can see it on this voter now.');
    } catch (caught) {
      toast.error('Could not propose', messageFor(caught));
    } finally {
      setProposing(false);
    }
  };

  /* ---- finalize ---- */
  const [finalizing, setFinalizing] = useState<string | null>(null);

  const runFinalize = async (phone: string, label: 'set' | 'clear') => {
    if (!uid) return;
    setFinalizing(label + phone);
    try {
      await finalizePhone({
        uid,
        voter: row,
        finalName: displayName || email.split('@')[0] || 'Unknown',
        finalPhone: phone,
      });
      toast.success(
        label === 'set' ? 'Number put in use' : 'Final choice cleared',
        label === 'set'
          ? `Call, WhatsApp and SMS now dial ${phone}.`
          : 'The board falls back to each account\'s own number.'
      );
    } catch (caught) {
      toast.error('Could not save the choice', messageFor(caught));
    } finally {
      setFinalizing(null);
    }
  };

  /* ---- corrections save ---- */
  const seedRef = useRef({ row, overlay });
  seedRef.current = { row, overlay };

  const buildPatch = (): Record<string, unknown> | string => {
    const current = seedRef.current.overlay;
    const base = row;
    const patch: Record<string, unknown> = {};

    const putString = (key: string, value: string, effectiveCurrent: string) => {
      if (value === effectiveCurrent) return;
      // A REAL clear means "key gone" → deleteField, so the consumer's `??`
      // fallback wakes up and the roll's own row shows again. Sending `''`
      // instead would store a key that renders as empty forever.
      patch[key] = value === '' ? deleteField() : value;
    };

    putString('name', form.name, current?.name ?? base.name);
    putString('fatherOrHusbandName', form.father, current?.fatherOrHusbandName ?? base.fatherOrHusbandName);
    putString('houseNo', form.houseNo, current?.houseNo ?? base.houseNo);
    putString('locality', form.locality, current?.locality ?? base.locality);
    putString('jati', form.jati, current?.jati ?? '');
    putString('leaningNote', form.leaningNote, current?.leaningNote ?? '');
    putString('note', form.note, current?.note ?? '');

    // Age — rules require an INT when the key exists (no '' clears possible),
    // so an emptied input means "unchanged"; an invalid one blocks the save.
    const effectiveAge = current?.age ?? base.age;
    if (form.age !== '') {
      const parsed = Number(form.age);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 130) {
        return 'Age must be a whole number between 0 and 130.';
      }
      if (parsed !== effectiveAge) patch.age = parsed;
    }

    if (form.gender !== (current?.gender ?? base.gender)) patch.gender = form.gender;

    // phone — raw-first validation (see contacts.ts), stored as the key.
    const trimmedPhone = form.phone.trim();
    const effectivePhone = current?.phone ?? '';
    if (trimmedPhone !== effectivePhone) {
      if (trimmedPhone === '') {
        patch.phone = deleteField();
      } else if (!isValidPhone(trimmedPhone)) {
        return 'That does not look like a phone number (6–15 digits, + ok).';
      } else {
        patch.phone = phoneKey(trimmedPhone);
      }
    }

    if (form.voted !== (current?.voted ?? 'unknown')) patch.voted = form.voted;
    if (form.leaning !== (current?.leaning ?? 'unknown')) patch.leaning = form.leaning;

    return patch;
  };

  const save = async () => {
    if (!uid || saving) return;
    const patch = buildPatch();
    if (typeof patch === 'string') {
      setFormError(patch);
      return;
    }
    if (Object.keys(patch).length === 0) {
      toast.info('Nothing changed', 'The form still matches the stored overlay.');
      return;
    }
    setFormError(null);
    setSaving(true);
    try {
      await saveVoterPatch(uid, row, patch);
      toast.success('Corrections saved', 'Stored in your account overlay — the phone app pulls the same document.');
    } catch (caught) {
      setFormError(messageFor(caught));
      toast.error('Save failed', messageFor(caught));
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setForm(seedFrom(seedRef.current.row, seedRef.current.overlay));
    setFormError(null);
  };

  /* ---- escape ---- */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const editedByMe = !!overlay;
  const tel = activeNum ? telUrl(activeNum) : null;
  const wa = activeNum ? whatsappUrl(activeNum) : null;

  return (
    <>
      {/* Backdrop */}
      <motion.div
        className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-[2px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        onClick={onClose}
      />

      {/* Sheet */}
      <motion.aside
        role="dialog"
        aria-modal="true"
        aria-label={`Voter ${row.name}`}
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 340, damping: 36 }}
        className="fixed inset-y-0 right-0 z-[61] flex w-[min(560px,100vw)] flex-col border-l border-line bg-ink-900 shadow-[-40px_0_80px_-40px_rgb(0_0_0/0.9)]"
      >
        {/* Header */}
        <header className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-semibold text-mist-50">
                {overlay?.name ?? row.name}
              </h2>
              {editedByMe ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-brand-400/35 bg-brand-500/12 px-1.5 py-0.5 text-[10px] font-medium text-brand-400">
                  <Check className="size-3" /> edited by you
                </span>
              ) : null}
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-mist-600">
              <span className="font-mono">{row.epicId || 'no EPIC'}</span>
              <span>ward {row.wardNo} · serial {row.serialNo}</span>
              <span>page {row.pdfPage || '—'}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close voter"
            className="rounded-lg p-2 text-mist-600 transition-colors hover:bg-black/5 dark:hover:bg-white/5 hover:text-mist-50"
          >
            <X className="size-4.5" />
          </button>
        </header>

        <div className="scroll flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {/* ---------------------------------------------------- contacts */}
          <Panel className="p-4" lit={!!activeNum}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-mist-600">
                Number in use
              </span>
              {board?.finalPhone ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-brand-400/35 bg-brand-500/12 px-1.5 py-0.5 text-[10px] font-medium text-brand-400">
                  <ShieldCheck className="size-3" />
                  final · {board.finalizedName}
                </span>
              ) : null}
            </div>

            <div className="mt-2.5 flex items-center justify-between gap-3">
              <p
                className={cn(
                  'font-mono text-xl tracking-wide',
                  activeNum ? 'text-mist-50' : 'text-mist-600'
                )}
              >
                {activeNum || '—'}
              </p>
              <div className="flex gap-2">
                <a
                  href={tel ?? undefined}
                  onClick={(event) => {
                    if (!tel) {
                      event.preventDefault();
                      toast.info('No number to dial', 'Propose or finalize a number first.');
                    }
                  }}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                    tel
                      ? 'border-signal-emerald/40 bg-signal-emerald/10 text-signal-emerald hover:bg-signal-emerald/20'
                      : 'pointer-events-none border-line bg-black/[0.02] dark:bg-white/[0.02] text-mist-600'
                  )}
                >
                  <Phone className="size-3.5" /> Call
                </a>
                <a
                  href={wa ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(event) => {
                    if (!wa) {
                      event.preventDefault();
                      toast.info('No number for WhatsApp', 'Propose or finalize a number first.');
                    }
                  }}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                    wa
                      ? 'border-[#25D366]/35 bg-[#25D366]/12 text-[#25D366] hover:bg-[#25D366]/20'
                      : 'pointer-events-none border-line bg-black/[0.02] dark:bg-white/[0.02] text-mist-600'
                  )}
                >
                  <MessageCircle className="size-3.5" /> WhatsApp
                </a>
              </div>
            </div>
            {!activeNum ? (
              <p className="mt-2.5 text-[11px] leading-relaxed text-mist-600">
                No finalized number falls through to this voter — buttons wait until a number
                exists on the board or in your own overlay.
              </p>
            ) : null}
            {board?.finalizedAt ? (
              <p className="mt-2 text-[10px] text-mist-600">
                Chosen {formatWhen(board.finalizedAt)} · {e164(activeNum) ?? activeNum}
              </p>
            ) : null}
          </Panel>

          {/* --------------------------------------------------- phone board */}
          <section>
            <div className="mb-2.5 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-mist-50">Team phone board</h3>
                <p className="text-[11px] text-mist-600">
                  One row per number · every proposer attached
                </p>
              </div>
              {canFinalize ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-brand-400">
                  <Star className="size-3" /> you may finalize
                </span>
              ) : null}
            </div>

            <Panel className="divide-y divide-line">
              {proposalsQuery.isLoading || boardQuery.isLoading ? (
                <div className="space-y-3 p-4">
                  <Skeleton className="h-12" />
                  <Skeleton className="h-12" />
                </div>
              ) : groups.length === 0 ? (
                <p className="px-4 py-5 text-center text-xs text-mist-600">
                  Nobody has proposed a number for this voter yet.
                </p>
              ) : (
                groups.map((group) => (
                  <div key={group.key} className="flex items-start gap-3 px-4 py-3.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm text-mist-50">{group.phone}</span>
                        {group.isFinal ? (
                          <span className="inline-flex items-center gap-1 rounded-md border border-brand-400/35 bg-brand-500/12 px-1.5 py-0.5 text-[10px] font-semibold text-brand-400">
                            <Star className="size-3 fill-current" /> in use
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                        {group.authors.slice(0, 4).map((author) => (
                          <span
                            key={author.uid}
                            className="inline-flex items-center gap-1 text-[11px] text-mist-400"
                          >
                            <span className="grid size-4 place-items-center rounded-full bg-black/[0.07] dark:bg-white/[0.07] text-[8px] font-semibold text-mist-200">
                              {(author.authorName[0] ?? '?').toUpperCase()}
                            </span>
                            {author.authorName}
                            <span className="text-mist-600">· {formatAgo(author.updatedAt)}</span>
                          </span>
                        ))}
                        {group.authors.length > 4 ? (
                          <span className="text-[11px] text-mist-600">
                            +{group.authors.length - 4} more
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {canFinalize && !group.isFinal ? (
                      <Button
                        variant="secondary"
                        onClick={() => void runFinalize(group.phone, 'set')}
                        disabled={finalizing !== null}
                        className="shrink-0 py-1 text-xs"
                      >
                        {finalizing === `set${group.phone}` ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Star className="size-3.5" />
                        )}
                        Make final
                      </Button>
                    ) : null}
                  </div>
                ))
              )}
            </Panel>

            {canFinalize && board?.finalPhone ? (
              <div className="mt-2.5 flex justify-end">
                <Button
                  variant="danger"
                  onClick={() => void runFinalize('', 'clear')}
                  disabled={finalizing !== null}
                  className="py-1.5 text-xs"
                >
                  <Trash2 className="size-3.5" /> Clear the final choice
                </Button>
              </div>
            ) : null}

            {canPropose ? (
              <div className="mt-3">
                <div className="flex gap-2">
                  <Input
                    value={proposalPhone}
                    onChange={(event) => {
                      setProposalPhone(event.target.value);
                      setProposalError(null);
                    }}
                    placeholder="Propose a number…"
                    inputMode="tel"
                    className="flex-1 font-mono"
                    aria-label="Proposed phone number"
                  />
                  <Button
                    variant="primary"
                    onClick={() => void submitProposal()}
                    disabled={proposing}
                    className="shrink-0"
                  >
                    {proposing ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <UserPlus className="size-4" />
                    )}
                    Propose
                  </Button>
                </div>
                {proposalError ? (
                  <p className="mt-1.5 text-[11px] text-signal-rose">{proposalError}</p>
                ) : (
                  <p className="mt-1.5 text-[11px] text-mist-600">
                    Saved as your one proposal for this voter — proposing again replaces your
                    previous number.
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-line bg-black/[0.02] dark:bg-white/[0.02] px-3 py-2 text-[11px] text-mist-600">
                <Info className="size-3.5" />
                Your role cannot propose numbers for ward {row.wardNo}.
              </p>
            )}
          </section>

          {/* -------------------------------------------------- corrections */}
          <section>
            <div className="mb-2.5 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-mist-50">Corrections</h3>
                <p className="text-[11px] text-mist-600">
                  Your account overlay — visible to you on every device, not written into the
                  official roll
                </p>
              </div>
            </div>

            <Panel className="space-y-4 p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name" className="sm:col-span-2">
                  <Input
                    value={form.name}
                    onChange={(event) => set('name', event.target.value)}
                  />
                </Field>
                <Field label="Father / husband" className="sm:col-span-2">
                  <Input
                    value={form.father}
                    onChange={(event) => set('father', event.target.value)}
                  />
                </Field>
                <Field label="House no.">
                  <Input
                    value={form.houseNo}
                    onChange={(event) => set('houseNo', event.target.value)}
                  />
                </Field>
                <Field label="Age">
                  <Input
                    value={form.age}
                    onChange={(event) => set('age', event.target.value)}
                    inputMode="numeric"
                    placeholder={String(row.age)}
                  />
                </Field>
                <Field label="Gender">
                  <Select
                    value={form.gender}
                    onChange={(event) => set('gender', event.target.value as Gender)}
                  >
                    {GENDERS.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Locality">
                  <Input
                    value={form.locality}
                    onChange={(event) => set('locality', event.target.value)}
                  />
                </Field>
                <Field label="Jati / caste" className="sm:col-span-2">
                  <Input
                    value={form.jati}
                    onChange={(event) => set('jati', event.target.value)}
                    placeholder="Free text — the roll's spellings are uncontrolled"
                  />
                </Field>

                <Field label="Own phone number" className="sm:col-span-2">
                  <Input
                    value={form.phone}
                    onChange={(event) => set('phone', event.target.value)}
                    inputMode="tel"
                    className="font-mono"
                    placeholder="Digits only stored · '+ survives normalization"
                  />
                </Field>

                <Field label="Voted">
                  <Select
                    value={form.voted}
                    onChange={(event) => set('voted', event.target.value as VotedStatus)}
                  >
                    {VOTED.map((value) => (
                      <option key={value} value={value}>
                        {value === 'notVoted' ? 'not voted' : value}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Leaning">
                  <Select
                    value={form.leaning}
                    onChange={(event) => set('leaning', event.target.value as Leaning)}
                  >
                    {LEANINGS.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Leaning note" className="sm:col-span-2">
                  <Input
                    value={form.leaningNote}
                    onChange={(event) => set('leaningNote', event.target.value)}
                  />
                </Field>
                <Field label="General note" className="sm:col-span-2">
                  <Textarea
                    value={form.note}
                    onChange={(event) => set('note', event.target.value)}
                    placeholder="Anything the team should know before knocking on this door"
                  />
                </Field>
              </div>

              {formError ? (
                <p className="rounded-lg border border-signal-rose/30 bg-signal-rose/10 px-3 py-2 text-xs text-signal-rose">
                  {formError}
                </p>
              ) : null}

              <div className="flex items-center justify-between gap-2 pt-1">
                <Button variant="ghost" onClick={reset} disabled={saving}>
                  <RotateCcw className="size-4" /> Reset
                </Button>
                <Button
                  variant="primary"
                  onClick={() => void save()}
                  disabled={saving}
                >
                  {saving ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Save className="size-4" />
                  )}
                  Save corrections
                </Button>
              </div>
            </Panel>
          </section>

          {/* ------------------------------------------------------ roll base */}
          <section className="pb-2">
            <h3 className="mb-2 text-sm font-semibold text-mist-50">Official roll row</h3>
            <Panel className="grid grid-cols-2 gap-x-5 gap-y-2.5 p-4 text-xs">
              {[
                ['Relation', `${row.relationLabel || row.relation} ${row.fatherOrHusbandName}`.trim()],
                ['Roll name', row.name],
                ['Roll house', row.houseNo],
                ['Roll age · sex', `${row.age} · ${row.gender}`],
                ['Roll locality', row.locality],
                ['Source page', `PDF p.${row.pdfPage}`],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-mist-600">
                    {label}
                  </p>
                  <p className="mt-0.5 text-mist-200">{value || '—'}</p>
                </div>
              ))}
            </Panel>
            <p className="mt-2 text-[10px] leading-relaxed text-mist-600">
              Read-only: `firestore.rules` denies every client write to `voters` — corrections
              live above, in your overlay.
            </p>
          </section>
        </div>
      </motion.aside>
    </>
  );
}