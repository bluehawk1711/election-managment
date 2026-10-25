'use client';

/**
 * next-themes, configured for the `.dark` class convention that
 * `app/globals.css` is written around (`@custom-variant dark (&:is(.dark *))`,
 * `.dark { … }` token block, `:root` = light).
 *
 * - `attribute="class"` — the toggle flips one class on `<html>`; every
 *   token and `dark:` utility follows from that single switch.
 * - `defaultTheme="system"` + `enableSystem` — a first-ever visit matches the
 *   OS, and next-themes' own pre-paint script applies it before first render,
 *   so there is no dark-flash on load and no hydration mismatch (the layout's
 *   `<html>` carries `suppressHydrationWarning` for exactly this).
 * - `disableTransitionOnChange` — switching mode re-paints instantly instead
 *   of tweening every colour on screen for 300ms.
 */
import { ThemeProvider } from 'next-themes';

export function AppTheme({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  );
}
