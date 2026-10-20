/**
 * The WhatsApp compose sheet — what actually goes out when a WhatsApp button
 * is pressed, edited by the person pressing it.
 *
 * It exists because the app used to attach a fixed campaign manifesto to
 * every WhatsApp link, and that text was wrong far more often than it was
 * right: a volunteer chasing one family's water complaint had to delete a
 * screenful of manifesto before typing a word, and half of them sent it by
 * accident. The message is now optional and editable HERE, at the moment of
 * sending — and the draft survives closing the sheet, so a follow-up to the
 * next voter on the same lane does not mean retyping the same sentence.
 *
 * Empty draft is a first-class outcome, not an error: confirming with no text
 * opens the chat with no pre-filled body (`whatsappUrl` drops `?text=`
 * entirely when the message is empty).
 *
 * Deliberately NOT a new dependency: an `AlertDialog` with one text area is
 * the whole surface this needs, and it inherits the app's sheet animation,
 * backdrop and dark mode for free.
 */
import { AlertDialog } from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { View } from '@/components/ui/view';
import { openExternal, whatsappUrl } from '@/lib/contact';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

interface Props {
  visible: boolean;
  /** The number the chat opens on — already normalized by the caller. */
  phone: string;
  message: string;
  onMessageChange: (text: string) => void;
  onClose: () => void;
  /** Called when nothing on the device would open the link. */
  onFail?: () => void;
}

export function WhatsAppCompose({
  visible,
  phone,
  message,
  onMessageChange,
  onClose,
  onFail,
}: Props) {
  const { t } = useTranslation();

  const send = () => {
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
        <Text variant='caption'>{t('whatsapp.hint')}</Text>
        <Input
          value={message}
          onChangeText={onMessageChange}
          placeholder={t('whatsapp.placeholder')}
          type='textarea'
          rows={6}
          autoFocus
          variant='outline'
        />
      </View>
    </AlertDialog>
  );
}

const styles = StyleSheet.create({
  body: { gap: 10 },
});
