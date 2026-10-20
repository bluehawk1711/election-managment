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
 * - `saved`   — whether anything is saved. The compose sheet shows its text
 *               field ONLY when this is false: if there is already a message,
 *               the reader is shown that message instead of a blank box they
 *               would have to fill before the sheet means anything.
 * - `ready`   — storage has been consulted. Until then neither branch is
 *               rendered, so a device that HAS a message never flashes an
 *               empty input for the length of a disk read.
 * - `setMessage` — writes straight through: typing is the save, there is no
 *               separate button to forget to press.
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
