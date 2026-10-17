'use client';

import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, Info, XCircle, X } from 'lucide-react';
import { useToasts } from '@/stores/toast';

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
} as const;

const TONES = {
  success: 'text-signal-emerald',
  error: 'text-signal-rose',
  info: 'text-signal-sky',
} as const;

/**
 * The toast host — fixed bottom-right, one stack, exit animated so a
 * dismissed message *moves away* rather than blinking (motion communicating
 * removal, not decorating it).
 */
export function Toaster() {
  const items = useToasts((s) => s.items);
  const dismiss = useToasts((s) => s.dismiss);

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[80] flex w-[min(380px,calc(100vw-2.5rem))] flex-col gap-2.5">
      <AnimatePresence initial={false}>
        {items.map((item) => {
          const Icon = ICONS[item.variant];
          return (
            <motion.div
              key={item.id}
              layout
              initial={{ opacity: 0, x: 32, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 32, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 460, damping: 34 }}
              className="panel edge-lit pointer-events-auto flex items-start gap-3 px-4 py-3 shadow-[0_24px_64px_-24px_rgb(0_0_0/0.8)]"
              role="status"
            >
              <Icon className={`mt-0.5 size-4.5 shrink-0 ${TONES[item.variant]}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-mist-50">{item.title}</p>
                {item.detail ? (
                  <p className="mt-0.5 break-words text-xs leading-relaxed text-mist-400">
                    {item.detail}
                  </p>
                ) : null}
              </div>
              <button
                onClick={() => dismiss(item.id)}
                aria-label="Dismiss notification"
                className="rounded-md p-1 text-mist-600 transition-colors hover:text-mist-200"
              >
                <X className="size-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}