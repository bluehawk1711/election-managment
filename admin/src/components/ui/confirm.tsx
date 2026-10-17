'use client';

/**
 * The one destructive-action confirmation — a centered modal with an explicit
 * cancel first, ENTER-safe focus, Escape to dismiss, and a backdrop click
 * that CANCELS (never confirms: a stray click on a dark backdrop dissolving
 * into a delete is the UI bug people remember).
 *
 * Motion communicates state: backdrop fades, card springs to place, confirm
 * button swaps label while the call is in flight so a double-click cannot
 * fire twice.
 */
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { Button } from './kit';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  detail: ReactNode;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  detail,
  confirmLabel = 'Delete',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[70] grid place-items-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
        >
          <div
            className="absolute inset-0 bg-black/65 backdrop-blur-sm"
            onClick={() => {
              if (!busy) onCancel();
            }}
          />
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97, transition: { duration: 0.12 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className="panel edge-lit relative w-full max-w-[420px] p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start gap-3.5">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-signal-rose/30 bg-signal-rose/10 text-signal-rose">
                <AlertTriangle className="size-5" />
              </span>
              <div className="min-w-0">
                <h2 className="text-[15px] font-semibold text-mist-50">{title}</h2>
                <div className="mt-1.5 text-xs leading-relaxed text-mist-400">{detail}</div>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2.5">
              <Button variant="ghost" onClick={onCancel} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={onConfirm}
                disabled={busy}
                autoFocus
              >
                {busy ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Working…
                  </>
                ) : (
                  confirmLabel
                )}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}