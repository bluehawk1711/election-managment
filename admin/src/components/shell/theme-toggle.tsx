'use client';

/**
 * The light/dark switch in the topbar.
 *
 * Shown as the mode you'd switch TO: moon while light is on screen, sun while
 * dark is — with an `aria-label` that names the destination, so screen
 * readers never have to infer intent from an icon.
 *
 * `resolvedTheme` is undefined on the server and until next-themes reads
 * storage, so the button renders an identically-sized placeholder for the
 * first frame. Rendering the icon immediately instead would make server and
 * client markup differ (system dark → client wants Sun, server rendered Moon)
 * and React would report a hydration mismatch.
 */
import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = mounted && resolvedTheme === 'dark';
  const next = isDark ? 'light' : 'dark';

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className="rounded-lg p-2 text-mist-400 transition-colors hover:bg-black/5 hover:text-mist-50 dark:hover:bg-white/5"
    >
      {mounted ? (
        isDark ? (
          <Sun className="size-5" aria-hidden />
        ) : (
          <Moon className="size-5" aria-hidden />
        )
      ) : (
        <span className="block size-5" aria-hidden />
      )}
    </button>
  );
}
