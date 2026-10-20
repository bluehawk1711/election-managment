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
 *  2. **What the user types is saved for them** (`useWhatsappMessage`), on
 *     every keystroke, so the next WhatsApp tap anywhere in the app offers
 *     that text back instead of asking for it again.
 *  3. **The text field appears only when NOTHING is saved.** A saved message
 *     is shown as read-only text — there is no box to retype into — and it is
 *     edited or cleared from Settings, which owns the same store.
 *
 * Confirming with nothing saved is a first-class outcome, not an error: it
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
import { useColor } from '@/hooks/useColor';
import { useWhatsappMessage } from '@/hooks/useWhatsappMessage';
import { openExternal, whatsappUrl } from '@/lib/contact';
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
  const { message, saved, ready, setMessage } = useWhatsappMessage();
  const card = useColor('card');
  const border = useColor('border');

  const send = () => {
    // Saved text or nothing — never a substitute either. `message.trim()` is
    // what makes "an unedited blank sheet" send a bare wa.me link rather than
    // a `?text=` with whitespace in it.
    const url = whatsappUrl(phone, message.trim());
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
      onClose={onClose}
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
        {/* Saved: show it, do not ask for it. Until storage answers (`ready`)
            neither branch renders, so a saved message never flickers an empty
            text field on the way in. */}
        {saved && ready ? (
          <>
            <Text variant='caption'>{t('whatsapp.savedHint')}</Text>
            <View style={[styles.saved, { borderColor: border, backgroundColor: card }]}>
              <Text variant='body'>{message}</Text>
            </View>
          </>
        ) : ready ? (
          <>
            <Text variant='caption'>{t('whatsapp.hint')}</Text>
            <Input
              value={message}
              onChangeText={setMessage}
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
  /** The saved message, boxed so it reads as content rather than as a hint. */
  saved: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
});
