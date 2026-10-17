/**
 * Toasts — a Zustand queue with auto-dismiss, rendered once by `<Toaster/>`.
 *
 * Positioned after `await`s by design: mutations call `toast.show(...)` on
 * settle, so the message always reflects what actually happened even on a
 * path that took the slow branch (rules rejection arrives as an exception and
 * shows a danger variant, not silence).
 */
import { create } from 'zustand';

export interface ToastItem {
  id: number;
  variant: 'success' | 'error' | 'info';
  title: string;
  detail?: string;
}

interface ToastState {
  items: ToastItem[];
  show: (item: Omit<ToastItem, 'id'>) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;
const LIFETIME_MS = 4500;

export const useToasts = create<ToastState>((set) => ({
  items: [],
  show: (item) => {
    const id = nextId++;
    set((state) => ({ items: [...state.items, { ...item, id }] }));
    setTimeout(() => {
      set((state) => ({ items: state.items.filter((t) => t.id !== id) }));
    }, LIFETIME_MS);
  },
  dismiss: (id) =>
    set((state) => ({ items: state.items.filter((t) => t.id !== id) })),
}));

/** Imperative helpers — usable outside components (mutation callbacks). */
export const toast = {
  success: (title: string, detail?: string) =>
    useToasts.getState().show({ variant: 'success', title, detail }),
  error: (title: string, detail?: string) =>
    useToasts.getState().show({ variant: 'error', title, detail }),
  info: (title: string, detail?: string) =>
    useToasts.getState().show({ variant: 'info', title, detail }),
};

/**
 * Firebase error codes → the sentence a human can act on. Mirrors the intent
 * of `mobile/lib/errors.ts` `messageFor` for the subset this panel can hit;
 * anything unknown falls back to a generic line plus the raw code, which is
 * more useful in an admin tool than a pretend translation.
 */
export function messageFor(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';

  const table: Record<string, string> = {
    'permission-denied':
      'The security rules refused this write for your account — check the role and ward scope you are acting with.',
    'not-found': 'That document no longer exists — it may have been deleted on another device.',
    'already-exists': 'That record already exists.',
    'failed-precondition': 'The operation is no longer valid — reload and try again.',
    'unavailable': 'Firestore is unreachable right now — check your connection and retry.',
    'resource-exhausted': 'Quota exceeded — wait a moment and retry.',
    'unauthenticated': 'Your session ended — sign in again.',
    'auth/email-already-in-use': 'That email address is already registered.',
    'auth/invalid-email': 'That email address is not valid.',
    'auth/weak-password': 'The password must be at least 6 characters.',
    'auth/invalid-credential': 'Wrong email or password.',
    'auth/too-many-requests': 'Too many attempts — wait a moment before retrying.',
  };

  if (table[code]) return table[code];

  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error);
  return code ? `${message} (${code})` : message;
}