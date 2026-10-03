import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollView } from '@/components/ui/scroll-view';
import { Text } from '@/components/ui/text';
import { useToast } from '@/components/ui/toast';
import { View } from '@/components/ui/view';
import { useCreateAccount } from '@/hooks/useCreateAccount';
import { APP_ROLES, can, roleLabelKey, type AppRole } from '@/lib/roles';
import { useAuth } from '@/providers/auth-provider';
import { useRouter } from 'expo-router';
import { AtSign, KeyRound, ShieldCheck, User, Users } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';

/**
 * New account (plan-voters.md §6.5).
 *
 * The ward field appears only for a karykarta, and is required there. That is
 * not a UI convenience: `firestore.rules` refuses to create a karykarta
 * without a positive ward, and refuses to create any other role *with* one —
 * a `wardNo` on an admin is invisible in `visibleWards` but shows up in the
 * document, which is exactly the kind of disagreement that becomes "why can
 * this account see ward 9". The form mirrors the rule rather than guessing.
 *
 * The role list is `APP_ROLES`, so a role added in `lib/roles.ts` appears here
 * with no second edit. It is not hard-coded, and it should not be.
 */
export default function NewAccountScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const { profile } = useAuth();
  const { create, creating, error } = useCreateAccount();

  const allowed = can(profile?.role ?? null, 'accountManage');

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<AppRole>('karykarta');
  const [wardNo, setWardNo] = useState('');
  const [touched, setTouched] = useState(false);

  // Wards 1–13, matching `wards-summary.csv`. Hard-coded because the roll is
  // not seeded in every environment (a fresh emulator has no `wards`
  // documents), and a picker that is empty until the roll loads is a picker
  // nobody can use to create the first karykarta.
  const wards = useMemo(() => Array.from({ length: 13 }, (_, index) => index + 1), []);

  const trimmedName = displayName.trim();
  const trimmedEmail = email.trim();

  const nameError = touched && !trimmedName ? t('accounts.nameRequired') : undefined;
  const emailError =
    touched && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmedEmail)
      ? t('accounts.emailInvalid')
      : undefined;
  const passwordError =
    touched && password.length < 6 ? t('accounts.passwordShort') : undefined;
  const wardError =
    touched && role === 'karykarta' && !(Number(wardNo) > 0)
      ? t('accounts.wardRequired')
      : undefined;

  const valid =
    trimmedName.length > 0 &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmedEmail) &&
    password.length >= 6 &&
    (role !== 'karykarta' || Number(wardNo) > 0);

  const submit = async () => {
    setTouched(true);
    if (!valid) return;

    const ok = await create({
      email: trimmedEmail,
      password,
      displayName: trimmedName,
      role,
      wardNo: role === 'karykarta' ? Number(wardNo) : null,
    });

    if (!ok) return;

    toast.success(t('accounts.created'), t('accounts.createdHint'));
    router.back();
  };

  if (!allowed) {
    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.denied}>
        <Card style={styles.deniedCard}>
          <Text variant='subtitle'>{t('accounts.superAdminOnly')}</Text>
        </Card>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps='handled'
    >
      <Input
        label={t('accounts.displayName')}
        icon={User}
        placeholder='Sunita Rathore'
        value={displayName}
        onChangeText={setDisplayName}
        error={nameError}
        autoCapitalize='words'
      />

      <Input
        label={t('accounts.email')}
        icon={AtSign}
        placeholder='sunita@example.com'
        value={email}
        onChangeText={setEmail}
        error={emailError}
        keyboardType='email-address'
        autoCapitalize='none'
        autoCorrect={false}
      />

      <Input
        label={t('accounts.password')}
        icon={KeyRound}
        placeholder='••••••••'
        value={password}
        onChangeText={setPassword}
        error={passwordError}
        secureTextEntry
        autoCapitalize='none'
      />

      {/* Role. A plain pressable row rather than a Picker: the native picker is
          a wheel on iOS and a spinner on Android, and there are four options —
          a tap target is faster for both, and it can show the role's meaning
          instead of just its name. */}
      <View style={styles.field}>
          <Text variant='caption'>{t('accounts.role')}</Text>
        <View style={styles.roles}>
          {APP_ROLES.map((option) => {
            const active = option === role;
            return (
              <Pressable
                key={option}
                onPress={() => setRole(option)}
                style={({ pressed }) => [
                  styles.role,
                  active && styles.roleActive,
                  pressed && styles.pressed,
                ]}
                accessibilityRole='radio'
                accessibilityState={{ selected: active }}
              >
                <ShieldCheck size={14} color={active ? '#fff' : undefined} />
                <Text variant='caption' style={active ? styles.roleTextActive : undefined}>
                  {t(roleLabelKey(option))}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {touched && !role ? <Text variant='caption'>{t('accounts.roleRequired')}</Text> : null}
      </View>

      {/* Ward, only for a karykarta. See the note at the top of the file. */}
      {role === 'karykarta' ? (
        <View style={styles.field}>
            <Text variant='caption'>{t('accounts.wardScope')}</Text>
          <View style={styles.wards}>
            {wards.map((no) => {
              const active = String(no) === wardNo;
              return (
                <Pressable
                  key={no}
                  onPress={() => setWardNo(String(no))}
                  style={({ pressed }) => [
                    styles.ward,
                    active && styles.wardActive,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole='radio'
                  accessibilityState={{ selected: active }}
                >
                  <Text
                    variant='caption'
                    style={active ? styles.roleTextActive : undefined}
                  >
                    {no}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {wardError ? <Text variant='caption'>{wardError}</Text> : null}
        </View>
      ) : null}

      {error ? <Text variant='caption'>{error}</Text> : null}

      <Button
        icon={Users}
        loading={creating}
        disabled={touched && !valid}
        onPress={submit}
      >
        {t('accounts.create')}
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 16, paddingBottom: 64 },
  denied: { padding: 20, paddingTop: 64 },
  deniedCard: { gap: 8 },
  field: { gap: 8 },
  roles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  role: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#8888',
  },
  roleActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  roleTextActive: { color: '#fff', fontWeight: '600' },
  pressed: { opacity: 0.7 },
  wards: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  ward: {
    minWidth: 44,
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#8888',
  },
  wardActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
});