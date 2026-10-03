import { DeleteAccountDialog } from '@/components/auth/delete-account-dialog';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { MediaPicker, type MediaAsset } from '@/components/ui/media-picker';
import { ModeToggle } from '@/components/ui/mode-toggle';
import { Progress } from '@/components/ui/progress';
import { ScrollView } from '@/components/ui/scroll-view';
import { Separator } from '@/components/ui/separator';
import { Text } from '@/components/ui/text';
import { useToast } from '@/components/ui/toast';
import { View } from '@/components/ui/view';
import { useAvatarUpload } from '@/hooks/useAvatarUpload';
import { useLanguage } from '@/hooks/useLanguage';
import { useProfile } from '@/hooks/useProfile';
import { messageFor } from '@/lib/errors';
import { auth } from '@/lib/firebase';
import { clearCache, cacheStorage } from '@/lib/roll/cache';
import { roleLabelKey } from '@/lib/roles';
import { useAuth } from '@/providers/auth-provider';
import { sendEmailVerification } from 'firebase/auth';
import { Database, User } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';

/** Native names — a reader who cannot read the current language still knows
 *  their own, which is the whole point of putting the switcher in Settings. */
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  hi: 'हिन्दी',
};

const initialsOf = (value: string) =>
  value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?';

const PROVIDER_LABELS: Record<string, string> = {
  password: 'email and password',
  'google.com': 'Google',
  'apple.com': 'Apple',
  emailLink: 'an email link',
};

export default function SettingsScreen() {
  const { t } = useTranslation();
  const { user, profile } = useAuth();
  const { update, saving } = useProfile();
  const { upload, uploading, progress } = useAvatarUpload();
  const { language, languages, setLanguage } = useLanguage();
  const toast = useToast();

  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [sendingVerification, setSendingVerification] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);

  const providerId = user?.providerData[0]?.providerId;

  /**
   * Drops the downloaded roll. Deliberately does NOT touch the user overlay:
   * `clearCache` only removes `roll:cache:*`, and fieldwork edits live under
   * `roll:overlay:*`. Losing a field visit's notes to reclaim a few megabytes of
   * voter roll would be a genuinely bad trade.
   */
  const clearRollCache = async () => {
    setClearingCache(true);
    await clearCache(cacheStorage);
    setClearingCache(false);
    toast.success(t('more.cacheCleared'));
  };

  const changeAvatar = async (assets: MediaAsset[]) => {
    const asset = assets[0];
    if (!asset) return;

    const url = await upload(asset);
    if (!url) {
      toast.error(
        'Could not upload',
        'Check storage.rules — the path has to start with your own uid.'
      );
      return;
    }

    if (await update({ photoURL: url })) {
      toast.success('Avatar updated');
    }
  };

  const saveName = async () => {
    if (await update({ displayName: displayName.trim() || null })) {
      toast.success('Saved');
    }
  };

  const resendVerification = async () => {
    if (!auth.currentUser) return;

    setSendingVerification(true);
    try {
      await sendEmailVerification(auth.currentUser);
      toast.success('Sent', `Check ${user?.email}.`);
    } catch (caught) {
      toast.error('Could not send', messageFor(caught));
    } finally {
      setSendingVerification(false);
    }
  };

  const nameChanged = displayName.trim() !== (profile?.displayName ?? '');

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 24, paddingTop: 120, gap: 20 }}
    >
      <Card style={{ alignItems: 'center', gap: 12 }}>
        <Avatar size={88}>
          {profile?.photoURL ? (
            <AvatarImage source={{ uri: profile.photoURL }} />
          ) : (
            <AvatarFallback>
              {initialsOf(profile?.displayName ?? user?.email ?? '')}
            </AvatarFallback>
          )}
        </Avatar>

        <View style={{ alignItems: 'center', gap: 4 }}>
          <Text variant='subtitle'>
            {profile?.displayName ?? 'No display name'}
          </Text>
          <Text variant='caption'>{user?.email}</Text>
          {providerId && (
            <Badge variant='secondary'>
              {`Signed in with ${PROVIDER_LABELS[providerId] ?? providerId}`}
            </Badge>
          )}

          {/* Role and ward, shown on the identity card rather than buried in a
              settings row: this is the one thing that explains why some screens
              are empty and others are not, and a user who cannot see it has no
              way to know whether to ask for access or wait. */}
          <View style={styles.badgeRow}>
            <Badge variant={profile?.role ? 'secondary' : 'destructive'}>
              {t(roleLabelKey(profile?.role ?? null))}
            </Badge>
            {profile?.role === 'karykarta' ? (
              <Badge variant='secondary'>{t('voters.ward', { no: profile.wardNo ?? 0 })}</Badge>
            ) : null}
          </View>
        </View>

        <MediaPicker
          mediaType='image'
          variant='outline'
          size='sm'
          buttonText='Change photo'
          showPreview={false}
          disabled={uploading || saving}
          onSelectionChange={changeAvatar}
          onError={(message) => toast.error('Picker error', message)}
        />

        {uploading && (
          <View style={{ alignSelf: 'stretch' }}>
            <Progress value={progress * 100} />
          </View>
        )}
      </Card>

      {/* Firebase signs a user in whether or not they have confirmed their
          address, so unlike Supabase there is no blocked state to hold them in
          — this card does the nagging instead. Gate the `(tabs)` guard in
          app/_layout.tsx on `user.emailVerified` if you want it mandatory. */}
      {user && !user.emailVerified && providerId === 'password' && (
        <Card style={{ gap: 12 }}>
          <Text variant='subtitle'>Verify your email</Text>
          <Text variant='caption'>
            We sent a link to {user.email}. Until you open it, password recovery
            and some providers will not link to this account.
          </Text>
          <Button
            variant='outline'
            size='sm'
            loading={sendingVerification}
            onPress={resendVerification}
          >
            Resend the link
          </Button>
        </Card>
      )}

      <Card style={{ gap: 12 }}>
        <Input
          label='Display name'
          icon={User}
          placeholder='Ada Lovelace'
          value={displayName}
          onChangeText={setDisplayName}
          autoCapitalize='words'
        />
        <Button
          disabled={!nameChanged || saving}
          loading={saving}
          onPress={saveName}
        >
          Save
        </Button>
      </Card>

      <Separator />

      {/* Language. A segmented pair rather than a picker: there are two, and
          Hindi is the default, so the common action (switch to English) should
          be one tap. `useLanguage` persists through i18next to AsyncStorage, so
          this survives a restart. */}
      <Card style={{ gap: 12 }}>
        <View style={{ gap: 2 }}>
          <Text variant='subtitle'>{t('more.language')}</Text>
          <Text variant='caption'>{t('more.languageHint')}</Text>
        </View>
        <View style={styles.languageRow}>
          {languages.map((code) => {
            const active = code === language;
            return (
              <Pressable
                key={code}
                onPress={() => setLanguage(code)}
                style={({ pressed }) => [
                  styles.languageChip,
                  active && styles.languageChipActive,
                  pressed && styles.pressed,
                ]}
                accessibilityRole='radio'
                accessibilityState={{ selected: active }}
              >
                <Text
                  variant='caption'
                  style={active ? styles.languageTextActive : undefined}
                >
                  {LANGUAGE_NAMES[code] ?? code}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Separator />

      <View style={{ alignItems: 'center' }}>
        <ModeToggle />
      </View>

      {/* Local data. Only the downloaded roll — see `clearRollCache` above for
          why this does not extend to the overlay. */}
      <Card style={{ gap: 12 }}>
        <View style={{ gap: 2 }}>
          <Text variant='subtitle'>{t('more.localData')}</Text>
          <Text variant='caption'>{t('more.clearCacheHint')}</Text>
        </View>
        <Button
          variant='outline'
          icon={Database}
          loading={clearingCache}
          onPress={clearRollCache}
        >
          {t('more.clearCache')}
        </Button>
      </Card>

      <Separator />

      <View style={{ gap: 12 }}>
        <SignOutButton />

        <Button variant='destructive' onPress={() => setConfirmingDelete(true)}>
          Delete account
        </Button>
        <Text variant='caption'>
          Deletion runs from this device — your tasks, avatar and profile are
          removed before the account itself. See hooks/useDeleteAccount.ts for
          what that guarantees and what it does not.
        </Text>
      </View>

      <DeleteAccountDialog
        visible={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  badgeRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'center' },
  languageRow: { flexDirection: 'row', gap: 8 },
  languageChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#8888',
  },
  languageChipActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  languageTextActive: { color: '#fff', fontWeight: '600' },
  pressed: { opacity: 0.7 },
});
