import { AlertDialog } from '@/components/ui/alert-dialog';
import { Icon } from '@/components/ui/icon';
import { Spinner } from '@/components/ui/spinner';
import { Text } from '@/components/ui/text';
import { useToast } from '@/components/ui/toast';
import { View } from '@/components/ui/view';
import { useColor } from '@/hooks/useColor';
import {
  getAccountCredential,
  type AccountCredential,
} from '@/lib/account-credentials';
import type { Profile } from '@/lib/documents';
import { roleLabelKey } from '@/lib/roles';
import * as Clipboard from 'expo-clipboard';
import {
  AtSign,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  type LucideProps,
} from 'lucide-react-native';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';

/**
 * A fixed-length dot run, not `'•'.repeat(password.length)`: a mask that
 * changes length with the secret is a mask that leaks the secret's length to
 * whoever is reading over the admin's shoulder — the exact reader this screen
 * exists for.
 */
const MASK = '••••••••';

/**
 * How long the last account stays rendered after the dialog is dismissed.
 *
 * Chosen against `AlertDialog`'s own choreography: it calls `onClose` 300ms
 * into its exit, and only *then* flips `isVisible`, which starts a second fade
 * of ~250ms. Clearing the content at `onClose` would therefore blank the card
 * while it is still on screen; 450ms lands after that second fade either way.
 */
const EXIT_GRACE_MS = 450;

/**
 * A trailing icon action — copy a field, or reveal the password it decorates.
 *
 * Module-level rather than an inline arrow for the usual reason: a component
 * declared in a render body is a new type every render, so React remounts it
 * instead of diffing it. Deliberately not shared with `TrailingButton` in
 * `app/(tabs)/more/users/new.tsx`: that one belongs to a screen, this one to a
 * dialog, and coupling the two costs more than the six lines it saves.
 */
function IconButton({
  icon,
  label,
  onPress,
}: {
  icon: ComponentType<LucideProps>;
  label: string;
  onPress: () => void;
}) {
  const outline = useColor('outline');

  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole='button'
      accessibilityLabel={label}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
    >
      <Icon name={icon} size={18} color={outline} />
    </Pressable>
  );
}

/**
 * One credential: a caption label above, the value beside its actions.
 *
 * The value is `selectable`, so a long-press copy works for a reader who does
 * not reach for the button, and it is allowed to wrap — an ellipsised email
 * that differs from what the copy button puts on the clipboard is worse than
 * a row that grows by a line.
 */
function CredentialRow({
  label,
  icon,
  value,
  masked,
  trailing,
  onCopy,
}: {
  label: string;
  icon: ComponentType<LucideProps>;
  value: string;
  masked?: boolean;
  trailing?: ReactNode;
  onCopy: () => void;
}) {
  const { t } = useTranslation();
  const outline = useColor('outline');
  const border = useColor('border');

  return (
    <View style={[styles.row, { borderColor: border }]}>
      <View style={styles.rowLabel}>
        <Icon name={icon} size={14} color={outline} />
        <Text variant='caption'>{label}</Text>
      </View>
      <View style={styles.rowBody}>
        <Text selectable style={[styles.value, masked && styles.masked]}>
          {masked ? MASK : value}
        </Text>
        <View style={styles.actions}>
          {trailing}
          <IconButton icon={Copy} label={t('common.copy')} onPress={onCopy} />
        </View>
      </View>
    </View>
  );
}

/**
 * The dialog body: fetches the stored credential for this one account and
 * renders what it finds.
 *
 * Mounted with a `key` of profile id *and* permission, which is what keeps two
 * accounts from ever showing each other's password — state does not survive a
 * key change, so there is no window where one account's fetched password sits
 * under another's name, and a permission change re-reads rather than trusting
 * whatever the previous permission had loaded.
 */
function Credentials({
  profile,
  revealPassword,
}: {
  profile: Profile;
  revealPassword: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();

  const [credential, setCredential] = useState<AccountCredential | null>(null);
  // `true` exactly when a read will happen, so an account whose password this
  // caller may not see never flashes a spinner — and so the "not permitted"
  // message below is the only thing that renders for one.
  const [loading, setLoading] = useState(revealPassword);
  // Revealed on open: the whole reason to tap an account is to read its
  // credentials, and making the reader press an eye first to see the thing
  // they came for is friction on a screen that does nothing else. The toggle
  // exists for the walk back to the desk, when the screen should not be
  // broadcasting the password to the room.
  const [revealed, setRevealed] = useState(true);

  useEffect(() => {
    if (!revealPassword) return;

    let cancelled = false;
    void getAccountCredential(profile.id)
      // The contract is that this never rejects; a rejection would otherwise
      // strand the spinner over an account that is perfectly fine to show.
      .catch(() => null)
      .then((found) => {
        if (cancelled) return;
        setCredential(found);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [profile.id, revealPassword]);

  const copy = async (value: string) => {
    if (!value) return;
    await Clipboard.setStringAsync(value);
    toast.success(t('common.copied'));
  };

  const email = credential?.email ?? profile.email ?? '';

  return (
    <View style={styles.stack}>
      <CredentialRow
        label={t('accounts.email')}
        icon={AtSign}
        value={email}
        onCopy={() => void copy(email)}
      />

      {!revealPassword ? (
        // Not a missing password — one this caller is not entitled to. An
        // `accountView` holder (admin upward) reads the roster; only
        // `accountManage` (super admin upward) reads what it was created with,
        // which is the same split `database.rules.json` draws for the writes.
        <Text variant='caption'>{t('accounts.passwordNotForRole')}</Text>
      ) : loading ? (
        <View style={styles.loading}>
          <Spinner size='sm' />
          <Text variant='caption'>{t('common.loading')}</Text>
        </View>
      ) : credential ? (
        <>
          <CredentialRow
            label={t('accounts.password')}
            icon={KeyRound}
            value={credential.password}
            masked={!revealed}
            onCopy={() => void copy(credential.password)}
            trailing={
              <IconButton
                icon={revealed ? EyeOff : Eye}
                label={t(
                  revealed ? 'common.hidePassword' : 'common.showPassword'
                )}
                onPress={() => setRevealed((was) => !was)}
              />
            }
          />
          <Text variant='caption'>{t('accounts.credentialsDeviceOnly')}</Text>
        </>
      ) : (
        <Text variant='caption'>{t('accounts.passwordNotStored')}</Text>
      )}
    </View>
  );
}

/**
 * Credentials dialog for one account (plan-voters.md §6.5).
 *
 * Tapping a row in the Accounts list opens it. The email is always shown — it
 * is already in the row that was tapped — while the password comes from this
 * device's own keystore (`lib/account-credentials.ts`) and only for a caller
 * holding `accountManage`, which is what `revealPassword` carries.
 *
 * There is no "wrong password" state to get right: when this device has no
 * record, the dialog says the password is not stored here rather than
 * rendering an empty field or inferring one.
 *
 * Contract: `onClose` must clear `profile`, which is what flips `isVisible`
 * and lets the dialog run its exit — every call site does exactly that.
 */
export function AccountCredentialsModal({
  profile,
  revealPassword,
  onClose,
}: {
  /** The tapped account, or `null` with the dialog closed. */
  profile: Profile | null;
  /** Whether the caller may see a stored password at all. */
  revealPassword: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  /**
   * The account still rendered while the dialog plays out its exit, set in
   * `handleClose` rather than in an effect — `AlertDialog` calls `onClose` as
   * its *first* act of closing, so by the time this runs `profile` is about to
   * go null, and clearing content on that null would empty the card under its
   * own fade.
   */
  const [closing, setClosing] = useState<Profile | null>(null);
  const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClose = useCallback(() => {
    // A dismissal that supersedes an earlier one must own the grace period,
    // or the earlier timer would blank the card during *this* exit.
    if (graceTimer.current) clearTimeout(graceTimer.current);

    setClosing(profile);
    onClose();
    graceTimer.current = setTimeout(() => setClosing(null), EXIT_GRACE_MS);
  }, [profile, onClose]);

  // The dialog is gone by the time this runs; only the timer is left to pay.
  useEffect(
    () => () => {
      if (graceTimer.current) clearTimeout(graceTimer.current);
    },
    []
  );

  const content = profile ?? closing;
  const roleText = content ? t(roleLabelKey(content.role)) : '';
  const description = content
    ? content.role === 'karykarta' && content.wardNo != null
      ? `${roleText} · ${t('voters.ward', { no: content.wardNo })}`
      : roleText
    : undefined;

  return (
    <AlertDialog
      isVisible={profile !== null}
      onClose={handleClose}
      title={content?.displayName ?? content?.email ?? content?.id}
      description={description}
      confirmText={t('common.close')}
      showCancelButton={false}
    >
      {content ? (
        <Credentials
          key={`${content.id}:${revealPassword}`}
          profile={content}
          revealPassword={revealPassword}
        />
      ) : null}
    </AlertDialog>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  row: {
    gap: 6,
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowBody: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  value: { flex: 1, minWidth: 0 },
  // Left-aligned dots read as a value rather than as a field's placeholder.
  masked: { letterSpacing: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconButton: { alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
