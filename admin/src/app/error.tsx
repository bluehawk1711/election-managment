'use client';

/**
 * The root error boundary — anything a page throws on render or in a hook
 * lands here instead of a white screen.
 *
 * `reset()` is the whole point of the file: it re-renders the segment's
 * children, so a transient Firestore failure (offline blip, permission
 * hiccup mid-snapshot) is one button away from recovery without a manual
 * reload that loses the session. The raw message is shown in a `<code>`
 * block on purpose — when someone screenshots this to the dev, the exact
 * error text is the thing that diagnoses it, and hiding it behind "Something
 * went wrong" is what turns a five-second fix into a support thread.
 *
 * The signed-out redirect in `providers.tsx` still runs above this boundary,
 * so an error thrown while signed out cannot trap the user in a loop with
 * the shell's auth gate.
 */
import { AlertTriangle, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';
import { Button } from '@/components/ui/kit';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server-side console for local debugging; swallowed errors are the
    // hardest kind to chase.
    console.error('[panel]', error);
  }, [error]);

  return (
    <div className="grid place-items-center px-4 py-16">
      <div className="panel edge-lit w-full max-w-[480px] p-6 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl border border-signal-rose/30 bg-signal-rose/10 text-signal-rose">
          <AlertTriangle className="size-5" />
        </span>
        <h2 className="mt-4 text-[15px] font-semibold text-mist-50">
          Something broke on this screen
        </h2>
        <p className="mt-1.5 text-xs leading-relaxed text-mist-400">
          The rest of the panel is fine — this is usually a transient
          Firestore or network failure. Retrying re-runs the screen without
          signing you out.
        </p>

        {error.message ? (
          <pre className='mt-4 max-h-40 overflow-auto rounded-lg border border-line bg-ink-900/80 px-3 py-2 text-left text-[11px] leading-relaxed text-signal-rose'>
            {error.message}
            {error.digest ? `\ndigest: ${error.digest}` : ''}
          </pre>
        ) : null}

        <div className="mt-5 flex items-center justify-center gap-2.5">
          <Button variant="primary" onClick={reset}>
            <RotateCcw className="size-4" /> Try again
          </Button>
          <Link href="/">
            <Button variant="ghost">Back to overview</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
