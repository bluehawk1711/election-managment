import { DeleteAccountDialog } from '@/components/auth/delete-account-dialog';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { ElectionDayCard } from '@/components/dashboard/election-day-card';
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
import { useWhatsappMessage } from '@/hooks/useWhatsappMessage';
import { messageFor } from '@/lib/errors';
import { auth } from '@/lib/firebase';
import { APP_VERSION } from '@/lib/app-config';
import { can, roleLabelKey } from '@/lib/roles';
import { useAuth } from '@/providers/auth-provider';
import { router } from 'expo-router';
import { sendEmailVerification } from 'firebase/auth';
import { User, UserPlus, Users } from 'lucide-react-native';
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
  // The message every WhatsApp button starts with. Editing here is a draft:
  // nothing is written until Save is pressed, which is the whole reason this
  // card has a button. The compose sheet opens on the saved text and keeps
  // its own edits per-send, so a one-off change never rewrites this default.
  const {
    message: savedWhatsapp,
    ready: whatsappReady,
    setMessage: saveWhatsapp,
  } = useWhatsappMessage();
  /** `null` = untouched draft, so the field follows storage until typed in. */
  const [whatsappDraft, setWhatsappDraft] = useState<string | null>(null);
  const whatsappMessage = whatsappDraft ?? savedWhatsapp;
  const whatsappHasText = whatsappMessage.trim().length > 0;
  // Whitespace-only text saves as nothing (`lib/whatsapp-message.ts`), so a
  // draft of spaces is not a change when the saved message is already empty.
  const whatsappChanged =
    whatsappDraft !== null &&
    (whatsappDraft.trim() ? whatsappDraft : '') !== savedWhatsapp;
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
  // Team-account management lives in Settings as well as the More hub: the
  // former is where a super admin looks for "account" actions, and the latter
  // is the module grid. Both routes are the same screen, so there is one
  // implementation and two ways in.
  const canManageAccounts = can(profile?.role ?? null, 'accountManage');

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

  const saveWhatsappMessage = () => {
    saveWhatsapp(whatsappMessage);
    // Hand the field back to storage: the hook updates synchronously, so the
    // draft is no longer needed and "unsaved changes" clears with the save.
    setWhatsappDraft(null);
    toast.success(t('settings.whatsappSavedToast'));
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

      {/* ── Team accounts ───────────────────────────────────────────────
          Super admins and developers can create accounts from Settings (the
          same screen as More → Accounts). The card is hidden for every other
          role rather than shown-and-refused: `database.rules.json` requires
          `accountManage` for the profile write, so a visible button could only
          ever fail. */}
      {canManageAccounts ? (
        <>
          <Text variant='caption' style={styles.sectionHeading}>
            {t('settings.team')}
          </Text>

          <Card style={{ gap: 12 }}>
            <View style={{ gap: 2 }}>
              <Text variant='subtitle'>{t('accounts.title')}</Text>
              <Text variant='caption'>{t('accounts.settingsHint')}</Text>
            </View>
            <Button
              icon={UserPlus}
              onPress={() => router.push('/(tabs)/more/users/new')}
            >
              {t('accounts.create')}
            </Button>
            <Button
              variant='outline'
              icon={Users}
              onPress={() => router.push('/(tabs)/more/users')}
            >
              {t('accounts.manage')}
            </Button>
          </Card>
        </>
      ) : null}

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

      {/* ── WhatsApp message ────────────────────────────────────────────
          This card owns the SAVED message; the compose sheet only borrows it
          as the starting text for one send. Typing here changes a draft, and
          Save is the only thing that writes — the earlier auto-save made
          people unsure whether their edit had actually stuck. Empty means
          "open the chat with no message", never a stand-in text: this app has
          no default message anywhere. */}
      <Card style={{ gap: 12 }}>
        <View style={{ gap: 2 }}>
          <Text variant='subtitle'>{t('settings.whatsappMessage')}</Text>
          <Text variant='caption'>{t('settings.whatsappMessageHint')}</Text>
        </View>
        <Input
          type='textarea'
          rows={4}
          value={whatsappMessage}
          onChangeText={setWhatsappDraft}
          placeholder={t('whatsapp.placeholder')}
          variant='outline'
          disabled={!whatsappReady}
        />
        <View style={styles.waRow}>
          <Button
            variant='outline'
            size='sm'
            disabled={!whatsappReady || !whatsappHasText}
            onPress={() => setWhatsappDraft('')}
          >
            {t('settings.whatsappClear')}
          </Button>
          <Button
            size='sm'
            style={{ flex: 1 }}
            disabled={!whatsappReady || !whatsappChanged}
            onPress={saveWhatsappMessage}
          >
            {t('common.save')}
          </Button>
        </View>
        {whatsappReady ? (
          <Text variant='caption' style={{ color: outline }}>
            {whatsappChanged
              ? t('settings.whatsappUnsaved')
              : whatsappHasText
                ? t('settings.whatsappMessageSaved')
                : t('settings.whatsappMessageEmpty')}
          </Text>
        ) : null}
      </Card>

      {/* ── Election day ────────────────────────────────────────────────
          The same self-contained card the dashboard shows — one component, one
          picker, one date in `campaigns/active` — so Settings and the banner
          cannot report different answers. It lives here because the date is
          campaign configuration a user may arrive looking to change, and a
          tap-to-edit card is both the display and the row. */}
      <ElectionDayCard />

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
  /** Clear button and its status line, sharing one baseline. */
  waRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  aboutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
