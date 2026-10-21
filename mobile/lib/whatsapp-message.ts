/**
 * The one message the app may put in front of a WhatsApp button — and it is
 * ALWAYS the user's own.
 *
 * There is no default here, by design. The build used to ship a fixed
 * campaign manifesto (and a canned "I need the new update" line on the gate),
 * which meant half the messages that went out under a volunteer's name were
 * text they never wrote. `whatsappUrl` therefore treats an empty string as a
 * first-class value: no text → a bare `wa.me` link that just opens the chat.
 *
 * The message saved in Settings lives here and is offered back on every
 * WhatsApp tap — a voter row, Help, the update gate — as the starting text
 * for that send. The compose sheet keeps edits per-send: changing one chat
 * never rewrites the saved default, which only Settings' explicit Save can
 * do. It lives in AsyncStorage: the message belongs to this device's drafts,
 * not to the campaign record, so it is deliberately NOT synced to the
 * database.
 *
 * `useWhatsappMessage` (hooks/useWhatsappMessage.ts) is the React face of
 * this module; everything here is framework-free so Settings and the compose
 * sheet can share one cache and stay in step through the same listeners.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'whatsapp.savedMessage';

/**
 * Last known value. `null` means "not read yet" (as opposed to an empty
 * message, which is `''`) — the distinction is what lets the compose sheet
 * render an input only after it knows there is nothing saved, instead of
 * flashing one on a device that already has a message.
 */
let cached: string | null = null;

/** The in-flight first read, so a mount storm costs one AsyncStorage call. */
let reading: Promise<string> | null = null;

type Listener = (message: string) => void;
const listeners = new Set<Listener>();

const notify = () => {
  for (const listener of listeners) listener(cached ?? '');
};

/**
 * The already-loaded value, or `null` when storage has not been consulted yet
 * — used by the hook so a re-mounted sheet opens on the saved text in the
 * same frame instead of a blank one.
 */
export function peekWhatsappMessage(): string | null {
  return cached;
}

/** The saved message, reading storage at most once per launch. */
export function readWhatsappMessage(): Promise<string> {
  if (cached !== null) return Promise.resolve(cached);
  reading ??= AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => {
      // A write may have landed while the read was in flight; that write is
      // newer than storage was, so it wins rather than being clobbered.
      if (cached === null) cached = raw ?? '';
      return cached;
    })
    .catch(() => {
      // Offline/unavailable storage must not block sending: fall back to
      // "nothing saved", which is the safe answer (no message goes out).
      if (cached === null) cached = '';
      return cached;
    });
  return reading;
}

/**
 * Save what the user typed — called by the hook from Settings' Save button,
 * so a message exists the moment the reader asks for it to be kept.
 *
 * Whitespace-only text is stored as NOTHING: an empty message must stay
 * empty, otherwise a stray space would silently turn "no message" into "a
 * message the user never wrote".
 */
export async function writeWhatsappMessage(text: string): Promise<void> {
  const next = text.trim() ? text : '';
  if (next === cached) return;
  cached = next;
  notify();

  try {
    if (next) await AsyncStorage.setItem(STORAGE_KEY, next);
    else await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // The in-memory copy is the message this session sends; a failed write
    // only costs the draft on the next launch, and never sends anything extra.
  }
}

/** Clears the saved message (Settings saves an empty draft the same way). */
export function clearWhatsappMessage(): Promise<void> {
  return writeWhatsappMessage('');
}

/** Fires on every save (including the first read's echo). Returns unsubscribe. */
export function subscribeWhatsappMessage(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam: forget the cache so the next read hits storage again. */
export function __resetWhatsappMessage(): void {
  cached = null;
  reading = null;
}
