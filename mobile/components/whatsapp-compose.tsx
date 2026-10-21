/**
 * The WhatsApp compose sheet — what actually goes out when ANY WhatsApp
 * button is pressed.
 *
 * Rules this sheet exists to enforce:
 *
 *  1. **There is no default message.** The build used to attach fixed text
 *     to every WhatsApp link (a campaign manifesto on voter rows, a canned
 *     line on Help and another on the update gate), and volunteers sent it
 *     by accident more often than they deleted it. Nothing the app wrote can
 *     reach the composer — see `lib/contact.ts::whatsappUrl`.
 *  2. **The saved message is a starting point, never a lock.** The field is
 *     always editable and opens on the message saved in Settings, so a
 *     recipient-specific tweak is one edit away instead of a trip to Settings.
 *  3. **An edit here lasts one send.** Nothing is written back: the saved
 *     default belongs to Settings, where an explicit Save button makes it
 *     obvious that a change was kept. Closing or sending discards the draft.
 *
 * Confirming with an empty field is a first-class outcome, not an error: it
 * opens the chat with no pre-filled body.
 *
 * Deliberately NOT a new dependency: an `AlertDialog` with one text area is
 * the whole surface this needs, and it inherits the app's sheet animation,
 * backdrop and dark mode for free.
 */
import { AlertDialog } from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { View } from '@/components/ui/view';
import { useWhatsappMessage } from '@/hooks/useWhatsappMessage';
import { openExternal, whatsappUrl } from '@/lib/contact';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

interface Props {
  visible: boolean;
  /** The number the chat opens on — already normalized by the caller. */
  phone: string;
  onClose: () => void;
  /** Called when nothing on the device would open the link. */
  onFail?: () => void;
}

export function WhatsAppCompose({ visible, phone, onClose, onFail }: Props) {
  const { t } = useTranslation();
  const { message, saved, ready } = useWhatsappMessage();
  /**
   * The per-send draft. `null` means "not edited yet", so the field shows the
   * saved message and even a storage read that lands AFTER the sheet opens
   * still fills it in. Typing makes the draft win; closing discards it,
   * because editing one chat must not silently rewrite the saved default.
   */
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? message;

  const close = () => {
    setDraft(null);
    onClose();
  };

  const send = () => {
    // What is in the field, or nothing — never a substitute. `trim()` is what
    // makes an empty sheet send a bare wa.me link rather than `?text=` with
    // whitespace in it.
    const url = whatsappUrl(phone, text.trim());
    // The draft is reset by `close`, after the sheet has faded out — clearing
    // it here would swap the field back to the saved text mid-animation.
    if (!url) {
      onFail?.();
      onClose();
      return;
    }
    void openExternal(url)
      .then((ok) => {
        if (!ok) onFail?.();
        onClose();
      })
      .catch(() => {
        onFail?.();
        onClose();
      });
  };

  return (
    <AlertDialog
      isVisible={visible}
      onClose={close}
      title={t('whatsapp.title')}
      confirmText={t('whatsapp.open')}
      cancelText={t('common.close')}
      onConfirm={send}
      // The link has been handed to WhatsApp at this point; whether the chat
      // actually opens is the platform's business, not something to sit on.
      closeOnConfirm
      dismissible
    >
      <View style={styles.body}>
        {/* Nothing renders until storage answers, so a saved message never
            flickers an empty field on the way in. After that the field is
            always editable — the saved text is a starting point, not a lock. */}
        {ready ? (
          <>
            <Text variant='caption'>
              {saved ? t('whatsapp.editHint') : t('whatsapp.hint')}
            </Text>
            <Input
              value={text}
              onChangeText={setDraft}
              placeholder={t('whatsapp.placeholder')}
              type='textarea'
              rows={6}
              autoFocus
              variant='outline'
            />
          </>
        ) : null}
      </View>
    </AlertDialog>
  );
}

const styles = StyleSheet.create({
  body: { gap: 10 },
});
