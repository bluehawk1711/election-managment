import { DeleteAccountDialog } from '@/components/auth/delete-account-dialog';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollView } from '@/components/ui/scroll-view';
import { Text } from '@/components/ui/text';
import { useToast } from '@/components/ui/toast';
import { View } from '@/components/ui/view';
import { useColor } from '@/hooks/useColor';
import { useLanguage } from '@/hooks/useLanguage';
import { useModeToggle } from '@/hooks/useModeToggle';
import { useProfile } from '@/hooks/useProfile';
import { messageFor } from '@/lib/errors';
import { auth } from '@/lib/firebase';
import { APP_VERSION } from '@/lib/app-config';
import { roleLabelKey } from '@/lib/roles';
import { useAuth } from '@/providers/auth-provider';
import { sendEmailVerification } from 'firebase/auth';
import { User } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';
import type { Mode } from '@/providers/mode-provider';

/** Native names — a reader who cannot read the current language still knows
 *  their own, which is the whole point of putting the switcher in Settings. */
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  hi: 'हिन्दी',
};

/** The three appearance modes, in the order the segmented control shows them. */
const MODES: readonly Mode[] = ['system', 'light', 'dark'];

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
  const { language, languages, setLanguage } = useLanguage();
  const { mode, setMode } = useModeToggle();
  const toast = useToast();
  // Theme tokens for the segmented controls — the stylesheet used to
  // hardcode a blue (#2563EB) and a grey border, which fought the dark
  // theme and drifted from the rest of the app's primary colour.
  const primary = useColor('primary');
  const primaryFg = useColor('primaryForeground');
  const border = useColor('border');
  const outline = useColor('outline');

  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [sendingVerification, setSendingVerification] = useState(false);
  /** Whether the delete-account confirmation is up — see the Session card. */
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const providerId = user?.providerData[0]?.providerId;

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
      contentContainerStyle={{ padding: 20, paddingBottom: 120, gap: 20 }}
    >
      {/* ── Identity ────────────────────────────────────────────────────
          The one thing on this screen that explains the rest of the app: role
          and ward are why some screens are full and others are empty, so they
          sit on the identity card rather than behind a row the user has to
          think to open. */}
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
            {profile?.displayName ?? t('settings.noDisplayName')}
          </Text>
          <Text variant='caption'>{user?.email}</Text>
          {providerId && (
            <Badge variant='secondary'>
              {t('settings.signedInWith', {
                method: PROVIDER_LABELS[providerId] ?? providerId,
              })}
            </Badge>
          )}

          <View style={styles.badgeRow}>
            <Badge variant={profile?.role ? 'secondary' : 'destructive'}>
              {t(roleLabelKey(profile?.role ?? null))}
            </Badge>
            {profile?.role === 'karykarta' ? (
              <Badge variant='secondary'>{t('voters.ward', { no: profile.wardNo ?? 0 })}</Badge>
            ) : null}
          </View>
        </View>

        {/* Profile photo upload was removed on purpose — the campaign does
            not use profile photos yet, and the picker + upload path was dead
            weight on a screen whose real job is identity and preferences. An
            EXISTING photo (set elsewhere) still renders above. */}
      </Card>

      {/* Firebase signs a user in whether or not they have confirmed their
          address, so unlike Supabase there is no blocked state to hold them in
          — this card does the nagging instead. Gate the `(tabs)` guard in
          app/_layout.tsx on `user.emailVerified` if you want it mandatory. */}
      {user && !user.emailVerified && providerId === 'password' && (
        <Card style={{ gap: 12 }}>
          <Text variant='subtitle'>{t('settings.verifyTitle')}</Text>
          <Text variant='caption'>
            {t('settings.verifyBody', { email: user.email ?? '' })}
          </Text>
          <Button
            variant='outline'
            size='sm'
            loading={sendingVerification}
            onPress={resendVerification}
          >
            {t('settings.verifyResend')}
          </Button>
        </Card>
      )}

      {/* ── Preferences ────────────────────────────────────────────────
          Grouped under one heading so the screen reads as "who you are" and
          "how the app looks" rather than a flat list of unrelated controls. */}
      <Text variant='caption' style={styles.sectionHeading}>
        {t('settings.preferences')}
      </Text>

      <Card style={{ gap: 14 }}>
        <Input
          label={t('settings.displayName')}
          icon={User}
          placeholder='Ada Lovelace'
          value={displayName}
          onChangeText={setDisplayName}
          autoCapitalize='words'
        />
        <Text variant='caption'>{t('settings.displayNameHint')}</Text>
        <Button
          disabled={!nameChanged || saving}
          loading={saving}
          onPress={saveName}
        >
          {t('common.save')}
        </Button>
      </Card>

      {/* Appearance. Previously a lone icon button floating between two
          separators, which gave no hint that it was a three-way choice — it
          cycled System → Light → Dark on every tap and showed nothing about
          where it currently sat. Three labelled segments make the current mode
          visible and make the jump to a specific one a single tap. */}
      <Card style={{ gap: 12 }}>
        <View style={{ gap: 2 }}>
          <Text variant='subtitle'>{t('settings.appearance')}</Text>
          <Text variant='caption'>{t('settings.appearanceHint')}</Text>
        </View>
        <View style={styles.segmentRow}>
          {MODES.map((value) => {
            const active = value === mode;
            return (
              <Pressable
                key={value}
                onPress={() => setMode(value)}
                style={({ pressed }) => [
                  styles.segment,
                  { borderColor: border },
                  active && { backgroundColor: primary, borderColor: primary },
                  pressed && styles.pressed,
                ]}
                accessibilityRole='radio'
                accessibilityState={{ selected: active }}
              >
                <Text
                  variant='caption'
                  style={active ? { color: primaryFg, fontWeight: '600' } : undefined}
                >
                  {t(`settings.mode.${value}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Card style={{ gap: 12 }}>
        <View style={{ gap: 2 }}>
          <Text variant='subtitle'>{t('more.language')}</Text>
          <Text variant='caption'>{t('more.languageHint')}</Text>
        </View>
        <View style={styles.segmentRow}>
          {languages.map((code) => {
            const active = code === language;
            return (
              <Pressable
                key={code}
                onPress={() => setLanguage(code)}
                style={({ pressed }) => [
                  styles.segment,
                  { borderColor: border },
                  active && { backgroundColor: primary, borderColor: primary },
                  pressed && styles.pressed,
                ]}
                accessibilityRole='radio'
                accessibilityState={{ selected: active }}
              >
                <Text
                  variant='caption'
                  style={active ? { color: primaryFg, fontWeight: '600' } : undefined}
                >
                  {LANGUAGE_NAMES[code] ?? code}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Card>

      {/* ── Session ───────────────────────────────────────────────────── */}
      <Text variant='caption' style={styles.sectionHeading}>
        {t('settings.account')}
      </Text>

      <Card style={{ gap: 12 }}>
        <SignOutButton />
        {/* Deletion belongs beside sign-out — they are the two ways out of an
            account — but it must not read as a sibling of it. The confirm step
            is not ceremony: Firebase refuses to delete an account on a stale
            token (`auth/requires-recent-login`), so the dialog reauthenticates
            with the typed password first, and keeps itself open when that
            fails so the reader can correct it. */}
        <Button
          variant='destructive'
          onPress={() => setConfirmingDelete(true)}
        >
          {t('settings.deleteAccount')}
        </Button>
      </Card>

      {/* ── About ───────────────────────────────────────────────────────
          The build's own version, baked in at compile time. The REQUIRED
          version lives in the admin panel's Settings page and is enforced by
          the update gate on launch — showing the local build here is what
          lets a user read the number off a modal that is blocking them. */}
      <Text variant='caption' style={styles.sectionHeading}>
        {t('settings.about')}
      </Text>

      <Card style={{ gap: 6 }}>
        <View style={styles.aboutRow}>
          <Text variant='caption' style={{ color: outline }}>
            {t('settings.version')}
          </Text>
          <Text variant='caption'>{APP_VERSION}</Text>
        </View>
        <Text variant='caption'>{t('app.tagline')}</Text>
      </Card>

      {/* A modal, mounted permanently and toggled by `visible` — so the screen
          owns one boolean and none of the dialog's state. */}
      <DeleteAccountDialog
        visible={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  badgeRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'center' },
  sectionHeading: { marginLeft: 4, letterSpacing: 0.6, textTransform: 'uppercase' },
  segmentRow: { flexDirection: 'row', gap: 8 },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    // The border/active colours come from the theme at each call site — a
    // hardcoded hex fought the dark theme.
  },
  pressed: { opacity: 0.7 },
  aboutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
