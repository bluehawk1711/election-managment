import { AuthScreen } from '@/components/auth/auth-screen';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { type LockNotice, readLockNotice } from '@/lib/device';
import { messageFor } from '@/lib/errors';
import { auth } from '@/lib/firebase';
import { router } from 'expo-router';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { AlertTriangle, Lock, Mail } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

/** Email link sign-in only works once a link domain is configured. */
const emailLinkEnabled = Boolean(process.env.EXPO_PUBLIC_FIREBASE_LINK_URL);

export default function SignInScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  // Why the LAST session ended in a lock-out — left on disk by
  // providers/auth-provider.tsx across the sign-out it performed, so the
  // screen a locked-out user lands on can say what happened instead of
  // silently accepting credentials it is going to refuse again.
  const [notice, setNotice] = useState<LockNotice | null>(null);
  useEffect(() => {
    let cancelled = false;
    readLockNotice().then((value) => {
      if (!cancelled) setNotice(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = async () => {
    setLoading(true);

    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      // No navigation call: the user lands, `onAuthStateChanged` fires, and the
      // guards in app/_layout.tsx swap `(auth)` out for `(tabs)`.
    } catch (caught) {
      // Firebase returns `auth/invalid-credential` for both a wrong password
      // and an unknown address when email enumeration protection is on — the
      // default for projects created since September 2023. That is deliberate:
      // it stops this form being used to discover who has an account. If you
      // see distinct errors instead, the setting is off in Authentication →
      // Settings → User actions.
      toast.error('Could not sign in', messageFor(caught));
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = email.trim().length > 0 && password.length > 0;

  return (
    <AuthScreen title='Welcome back' subtitle='Sign in to continue.'>
      {notice ? (
        <View style={styles.lockedBanner}>
          <View style={styles.lockedHeading}>
            <AlertTriangle size={16} color='#F87171' />
            <Text style={styles.lockedTitle}>
              {notice.reason === 'device_change'
                ? 'Account locked — opened on another device'
                : 'Account locked by an administrator'}
            </Text>
          </View>
          <Text style={styles.lockedBody}>
            {notice.reason === 'device_change'
              ? 'This account is bound to one device. Signing in from a second device locked it. Ask the super admin to unlock it — this device then re-binds on the next sign-in.'
              : 'A super admin locked this account. Only they can unlock it — contact your administrator to get access back.'}
          </Text>
        </View>
      ) : null}
      {/* ── Not shipping yet ──────────────────────────────────────────────
          Both footer entry points are commented out for now.

          · "Forgot your password?" — the reset flow depends on
            EXPO_PUBLIC_FIREBASE_LINK_URL and a claimed Universal Link /
            App Link domain. Without one it lands the user on Firebase's
            hosted page and they never come back to the app, which is a
            worse dead end than no button at all. The flow is built and
            tested; it needs the Hosting domain wired up first.

          · "Create an account" — accounts are provisioned by a super admin
            (More → Accounts) or by `pnpm run create:user`. Public self
            sign-up would put the election roll behind an open door: every new
            account would be role-less, and no role means no capabilities, so a
            stranger would install the app and see nothing but the no-role
            empty state.

          Re-enable by passing them back as `footer` on the `AuthScreen` above;
          `router` is still imported for the email-link button below. */}
      <Input
        label='Email'
        icon={Mail}
        placeholder='you@example.com'
        value={email}
        onChangeText={setEmail}
        autoCapitalize='none'
        autoComplete='email'
        keyboardType='email-address'
        textContentType='emailAddress'
      />

      <Input
        label='Password'
        icon={Lock}
        placeholder='Your password'
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize='none'
        autoComplete='current-password'
        textContentType='password'
        onSubmitEditing={() => canSubmit && signIn()}
      />

      <Button
        disabled={!canSubmit || loading}
        loading={loading}
        onPress={signIn}
      >
        Sign in
      </Button>

      {/* Hidden until EXPO_PUBLIC_FIREBASE_LINK_URL is set. Firebase Dynamic
          Links shut down in August 2025, so an email link now needs a Hosting
          domain the app claims through Universal Links / App Links — offering
          the button before that is set up would send users a link that opens a
          web page and never comes back. See the README. */}
      {emailLinkEnabled && (
        <Button
          variant='secondary'
          disabled={loading}
          onPress={() => router.push('/email-link')}
        >
          Email me a link instead
        </Button>
      )}

    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  lockedBanner: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#F87171',
    backgroundColor: 'rgba(248, 113, 113, 0.08)',
    padding: 12,
    gap: 6,
    marginBottom: 4,
  },
  lockedHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lockedTitle: { flex: 1, fontSize: 13, fontWeight: '600', color: '#F87171' },
  lockedBody: { fontSize: 12, lineHeight: 17, color: '#9CA3AF' },
});
