import { AlertDialog } from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useToast } from '@/components/ui/toast';
import { View } from '@/components/ui/view';
import { useDeleteAccount } from '@/hooks/useDeleteAccount';
import { useAuth } from '@/providers/auth-provider';
import { Lock } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Confirms, reauthenticates, then deletes.
 *
 * `deleteUser` throws `auth/requires-recent-login` unless the user signed in
 * within roughly the last five minutes — deleting an account is exactly the
 * operation Firebase will not take on a stale token. So a password-account user
 * types their password here and `useDeleteAccount` exchanges it for a fresh
 * credential.
 *
 * A federated user (Google, Apple) has no password to type. Reauthenticating
 * them means re-running the provider flow, which is a different enough shape
 * that this dialog sends them to sign out and back in instead — honest, and
 * shorter than a second copy of the OAuth code.
 *
 * Replaces the `delete-account` edge function a Supabase project would deploy.
 * Firebase lets a user delete their own account from the client, so no server
 * is needed — but read the comment in `hooks/useDeleteAccount.ts` about what
 * that costs in cascade guarantees.
 */
export function DeleteAccountDialog({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { deleteAccount, deleting } = useDeleteAccount();
  const [password, setPassword] = useState('');
  const toast = useToast();

  // `password` means an email/password account. Anything else came from a
  // provider and cannot be reauthenticated with a typed secret.
  const usesPassword = user?.providerData.some(
    (provider) => provider.providerId === 'password'
  );

  const confirm = async () => {
    // The dialog stays open while a deletion is in flight (`closeOnConfirm`
    // below), so a second tap while the first is still working would start a
    // second teardown over the same documents.
    if (deleting) return;
    if (usesPassword && !password) return;

    const ok = await deleteAccount(usesPassword ? password : undefined);

    if (!ok) {
      // Still on screen — which is the point of `closeOnConfirm={false}`.
      // `auth/wrong-password` and `auth/requires-recent-login` are both
      // *fixable here*, and a dialog that closes on the reader the moment it
      // fails turns "check your password" into "which password?".
      toast.error(
        t('settings.deleteFailed'),
        usesPassword
          ? t('settings.deleteFailedPassword')
          : t('settings.deleteFailedProvider')
      );
      return;
    }

    // No navigation: the auth listener fires with null and the route guards
    // put the user back on sign-in.
    setPassword('');
    onClose();
  };

  return (
    <AlertDialog
      isVisible={visible}
      onClose={onClose}
      title={t('settings.deleteTitle')}
      confirmText={deleting ? t('settings.deletePending') : t('settings.deleteConfirm')}
      cancelText={t('settings.deleteCancel')}
      onConfirm={confirm}
      closeOnConfirm={false}
      onCancel={() => {
        setPassword('');
        onClose();
      }}
      dismissible={!deleting}
    >
      <View style={{ gap: 12 }}>
        <Text variant='caption'>{t('settings.deleteBody')}</Text>

        {usesPassword ? (
          <Input
            label={t('settings.deletePasswordLabel')}
            icon={Lock}
            placeholder={t('settings.deletePasswordPlaceholder')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize='none'
            textContentType='password'
          />
        ) : (
          <Text variant='caption'>{t('settings.deleteProviderNote')}</Text>
        )}
      </View>
    </AlertDialog>
  );
}
