import {
  peekWhatsappMessage,
  readWhatsappMessage,
  subscribeWhatsappMessage,
  writeWhatsappMessage,
} from '@/lib/whatsapp-message';
import { useEffect, useState } from 'react';

/**
 * The saved WhatsApp message, kept identical on every screen that shows it.
 *
 * - `message` — what a WhatsApp button will send (`''` = nothing at all).
 * - `saved`   — whether anything is saved. The compose sheet uses this to
 *               choose its hint: a saved message is filled in as a starting
 *               point, but the field stays editable either way.
 * - `ready`   — storage has been consulted. Until then the compose sheet
 *               renders no field, so a device that HAS a message never
 *               flashes an empty input for the length of a disk read.
 * - `setMessage` — writes straight through. Settings calls it from its Save
 *               button, so the only implicit save is the one the reader
 *               explicitly asked for; the compose sheet keeps its own draft.
 */
export function useWhatsappMessage(): {
  message: string;
  saved: boolean;
  ready: boolean;
  setMessage: (text: string) => void;
} {
  const [message, setMessageState] = useState(() => peekWhatsappMessage() ?? '');
  const [ready, setReady] = useState(() => peekWhatsappMessage() !== null);

  useEffect(() => {
    const unsubscribe = subscribeWhatsappMessage((next) => {
      setMessageState(next);
      setReady(true);
    });
    void readWhatsappMessage().then((stored) => {
      setMessageState(stored);
      setReady(true);
    });
    return unsubscribe;
  }, []);

  const setMessage = (text: string) => {
    // Optimistic first: the field must never lag a keystroke waiting on disk.
    setMessageState(text);
    void writeWhatsappMessage(text);
  };

  return {
    message,
    saved: message.trim().length > 0,
    ready,
    setMessage,
  };
}
