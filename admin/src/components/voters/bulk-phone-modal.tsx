"use client";

/**
 * Bulk phone update — the panel's port of mobile's `/voters/bulk`.
 *
 * The shape is deliberately the same because the job is the same:
 *
 *   shared field   one number typed once fills every row that has not been
 *                  edited by hand. Clearing the shared field never wipes a
 *                  row (the operator may be mid-correction).
 *   voter rows     photo, name, EPIC and the voter's own field. The rows are
 *                  the check against the faces, and each one stays editable.
 *   two save spots the top one finishes "type a number, press once"; the
 *                  bottom one finishes "I corrected a row by hand". Neither
 *                  should require scrolling past forty rows to reach.
 *
 * Every write goes through `saveVoterPatch`, the same function the single
 * voter drawer uses, so the account-private overlay, its bookkeeping keys and
 * the rules payload stay identical. A valid number is also proposed to the
 * shared board best-effort, exactly as mobile's bulk screen does — the local
 * overlay is the save; a rejected share stays private.
 */
import { Loader2, Phone, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Input, Panel } from "@/components/ui/kit";
import { proposePhone, saveVoterPatch } from "@/lib/api";
import { isValidPhone, phoneKey } from "@/lib/contacts";
import { photoUrlFor } from "@/lib/roll/bundled";
import type { VoterView } from "@/lib/roll/types";
import { messageFor, toast } from "@/stores/toast";
import { useSession } from "@/stores/session";

interface Props {
  voters: VoterView[];
  onClose: () => void;
  /** Runs after a successful write — the page clears its selection. */
  onSaved?: () => void;
}

export function BulkPhoneModal({ voters, onClose, onSaved }: Props) {
  const uid = useSession((s) => s.uid);
  const displayName = useSession((s) => s.displayName);
  const email = useSession((s) => s.email);

  /** Per-voter drafts. Absent means "seed from the voter's own row". */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [shared, setSharedState] = useState("");
  const sharedRef = useRef("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** What a row shows: the draft, else the number already on file. */
  const draftFor = (voter: VoterView) =>
    drafts[voter.id] !== undefined
      ? drafts[voter.id]
      : (voter.effective.phone ?? "");

  const setDraft = (voterId: string, text: string) =>
    setDrafts((previous) => ({ ...previous, [voterId]: text }));

  /**
   * The one shared writer. Only rows still holding the previous shared value
   * (or nothing at all) are overwritten, so a hand-corrected row survives the
   * next keystroke in the shared field.
   */
  const setShared = (text: string) => {
    const previous = sharedRef.current.trim();
    sharedRef.current = text;
    setSharedState(text);

    const value = text.trim();
    if (!value) return;
    setDrafts((old) => {
      const next = { ...old };
      for (const voter of voters) {
        const current =
          old[voter.id] !== undefined
            ? old[voter.id].trim()
            : (voter.effective.phone ?? "").trim();
        const untouched = old[voter.id] === undefined;
        const carriesPrevious = previous !== "" && current === previous;
        if (untouched || carriesPrevious) next[voter.id] = value;
      }
      return next;
    });
  };

  /** Rows that currently hold a usable number — the save button's count. */
  const readyCount = useMemo(
    () =>
      voters.filter((voter) => isValidPhone(draftFor(voter).trim())).length,
    // `drafts` is the reactive half; `voters` carries the fallback values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [voters, drafts],
  );

  const save = async () => {
    if (!uid || busy) return;

    const targets = voters
      .map((voter) => ({ voter, phone: draftFor(voter).trim() }))
      .filter((target) => target.phone !== "");

    if (targets.length === 0) {
      setError("Enter at least one mobile number.");
      return;
    }

    const invalid = targets.filter((target) => !isValidPhone(target.phone));
    if (invalid.length > 0) {
      setError(
        `Not a usable number: ${invalid
          .slice(0, 3)
          .map((target) => target.voter.effective.name)
          .join(", ")}${invalid.length > 3 ? ` (+${invalid.length - 3})` : ""}`,
      );
      return;
    }

    setError(null);
    setBusy(true);
    const authorName = displayName || email.split("@")[0] || "Unknown";
    let changed = 0;

    try {
      for (const target of targets) {
        const value = phoneKey(target.phone);
        if (value === phoneKey(target.voter.effective.phone ?? "")) continue;

        await saveVoterPatch(uid, target.voter, { phone: value });
        changed += 1;

        // Best-effort board proposal, exactly like mobile's bulk apply. The
        // overlay above is the save; a rejected share must not fail the batch.
        void proposePhone({
          uid,
          voter: target.voter,
          phone: value,
          authorName,
        }).catch(() => undefined);
      }

      if (changed === 0) {
        toast.info("No changes", "Those rows already hold the same numbers.");
        return;
      }

      toast.success(
        `${changed.toLocaleString()} mobile numbers saved`,
        "Saved to your account; valid numbers were also offered to the shared phone board.",
      );
      onSaved?.();
      onClose();
    } catch (caught) {
      const message = messageFor(caught);
      setError(message);
      toast.error("Bulk save failed", message);
    } finally {
      setBusy(false);
    }
  };

  // Escape closes unless a write is in flight.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  if (typeof document === "undefined") return null;

  const saveButton = (
    <Button
      variant="primary"
      className="w-full"
      onClick={() => void save()}
      disabled={busy || readyCount === 0}
    >
      {busy ? (
        <>
          <Loader2 className="size-4 animate-spin" />
          Saving…
        </>
      ) : (
        <>
          <Phone className="size-4" />
          Save {readyCount.toLocaleString()} mobile numbers
        </>
      )}
    </Button>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[70] grid place-items-center p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Bulk mobile numbers"
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={() => {
          if (!busy) onClose();
        }}
      />
      <div className="panel edge-lit relative flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden">
        <header className="flex items-center gap-3 border-b border-line px-5 py-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-brand-400/30 bg-brand-500/10 text-brand-400">
            <Phone className="size-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-mist-50">
              Bulk mobile numbers
            </h2>
            <p className="mt-0.5 text-xs text-mist-600">
              {voters.length.toLocaleString()} selected · saved to your account
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close bulk phone update"
            className="rounded-lg p-2 text-mist-600 transition-colors hover:bg-white/5 hover:text-mist-50 disabled:opacity-40"
          >
            <X className="size-4.5" />
          </button>
        </header>

        <div className="scroll flex-1 space-y-4 overflow-y-auto px-5 py-5">
          <Panel className="space-y-3 p-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.08em] text-mist-600">
                One number for everyone
              </span>
              <Input
                value={shared}
                onChange={(event) => setShared(event.target.value)}
                inputMode="tel"
                placeholder="98765 43210"
                disabled={busy}
                autoFocus
              />
            </label>
            <p className="text-xs leading-relaxed text-mist-600">
              Typing fills every row. Correct any row below by hand — a corrected
              row keeps its own number.
            </p>
            {saveButton}
          </Panel>

          <div className="space-y-2">
            {voters.map((voter) => (
              <BulkPhoneRow
                key={voter.id}
                voter={voter}
                value={draftFor(voter)}
                disabled={busy}
                onChange={(text) => setDraft(voter.id, text)}
              />
            ))}
          </div>

          <p className="text-xs text-mist-600">
            {readyCount.toLocaleString()} of {voters.length.toLocaleString()} rows
            have a usable number. Empty rows are left untouched.
          </p>
          {saveButton}
          {error ? (
            <p className="text-xs leading-relaxed text-signal-rose">{error}</p>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------- row */

function BulkPhoneRow({
  voter,
  value,
  disabled,
  onChange,
}: {
  voter: VoterView;
  value: string;
  disabled?: boolean;
  onChange: (text: string) => void;
}) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const photo = photoUrlFor(voter.id, voter.wardNo);
  const e = voter.effective;

  return (
    <div className="rounded-xl border border-line bg-white/[0.02] p-3">
      <div className="flex items-center gap-3">
        {photo && !photoFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt={e.name}
            onError={() => setPhotoFailed(true)}
            className="size-12 shrink-0 rounded-lg border border-line object-cover"
          />
        ) : (
          <div className="grid size-12 shrink-0 place-items-center rounded-lg border border-dashed border-line text-[10px] text-mist-600">
            फोटो
          </div>
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-mist-50">
            {e.name}
          </p>
          <p className="truncate text-xs text-mist-400">
            <span className="font-mono">{voter.epicId || "no EPIC"}</span>
            <span className="text-mist-600">
              {" "}· क्रमांक {voter.serialNo} · वार्ड {voter.wardNo}
            </span>
          </p>
          {e.fatherOrHusbandName ? (
            <p className="truncate text-[11px] text-mist-600">
              {voter.relationLabel} {e.fatherOrHusbandName}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-2.5">
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          inputMode="tel"
          placeholder="Mobile number"
          aria-label={`Mobile number for ${e.name}`}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
