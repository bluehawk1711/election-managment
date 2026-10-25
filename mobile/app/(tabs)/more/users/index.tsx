import { AccountCredentialsModal } from '@/components/campaign/account-credentials-modal';
import { ListRow } from '@/components/campaign/list-row';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { Text } from '@/components/ui/text';
import { View } from '@/components/ui/view';
import { useCollection } from '@/hooks/useCollection';
import { COLLECTIONS } from '@/lib/collections';
import { profileFromDoc, type Profile } from '@/lib/documents';
import type { DbSnapshot } from '@/lib/db';
import { can, roleLabelKey } from '@/lib/roles';
import { useAuth } from '@/providers/auth-provider';
import { useRouter } from 'expo-router';
import { ShieldOff, UserCog, Users } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet } from 'react-native';

/**
 * RTDB document → `Profile`, for `useCollection`.
 *
 * A module-level function, not an inline arrow: `useCollection` takes `mapDoc`
 * in its dependency array, so an inline mapper would tear down and resubscribe
 * the listener on every single render.
 */
const toProfile = (doc: DbSnapshot): Profile | null => profileFromDoc(doc);

/**
 * Accounts list (plan-voters.md §6.5).
 *
 * Runs on `useCollection`, which is a live listener — so a role granted on one
 * device shows up here without a refetch. That matters more than usual here,
 * because the most common reason to open this screen is "did my change to
 * someone's role land?", and a screen that needs a manual reload to answer
 * that invites the reader to reload manually.
 *
 * `database.rules.json` denies the `users` list to anyone without
 * `canViewAccounts`, so the gate below is a convenience: it stops a karykarta
 * opening a screen that could only ever error, and lets it say why rather than
 * show a red box.
 *
 * **View vs manage.** The roster is viewable by `accountView` (admin upward) —
 * an admin has to be able to see the team a super admin created — while the
 * Create button demands `accountManage` (super admin upward), matching the two
 * rule helpers. An admin therefore reads this screen in full and simply has no
 * create button; nothing hidden-but-broken.
 *
 * Sorted in memory rather than with `orderBy`: `displayName` is optional, and
 * RTDB has no "drop the children missing this field" trap the way Firestore's
 * `orderBy` does — but sorting in memory keeps the one thing that does matter
 * here, which is that an account with no display name and no email still sorts
 * by its id rather than disappearing from the list.
 */
export default function UsersScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { profile } = useAuth();

  const canView = can(profile?.role ?? null, 'accountView');
  const canManage = can(profile?.role ?? null, 'accountManage');

  /**
   * The tapped account, i.e. the credentials dialog's subject.
   *
   * Every row opens it. What the dialog *shows* is another matter: the email
   * is already visible in the row itself, while the password comes from this
   * device's keystore and only for `accountManage` — see
   * `components/campaign/account-credentials-modal.tsx`.
   */
  const [selected, setSelected] = useState<Profile | null>(null);

  const { docs, loading, error } = useCollection<Profile | null>(
    COLLECTIONS.users,
    toProfile,
    { enabled: canView }
  );

  const profiles = useMemo(
    () =>
      docs
        .filter((item): item is Profile => item !== null)
        .sort((a, b) =>
          (a.displayName ?? a.email ?? a.id).localeCompare(
            b.displayName ?? b.email ?? b.id
          )
        ),
    [docs]
  );

  if (!canView) {
    return (
      <View style={styles.centered}>
        <Card style={styles.denied}>
          <ShieldOff size={28} />
          <Text variant='subtitle'>{t('accounts.superAdminOnly')}</Text>
          <Text variant='caption'>{t('accounts.listDenied')}</Text>
          {/* The single most-asked question behind "account creation is
              broken": WHICH role am I actually signed in as? Fresh accounts
              are roleless by design, and a roleless admin sees this same
              screen with no hint that the fix is a role grant, not a bug. */}
          <Text variant='caption'>
            {t('accounts.yourRole', {
              role: t(roleLabelKey(profile?.role ?? null)),
            })}
          </Text>
        </Card>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <FlatList
        data={profiles}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.header}>
            {/* Create is managed, not viewed: an admin reads the roster and
                can also create an account — the same split as the rules. */}
            {canManage ? (
              <Button icon={UserCog} onPress={() => router.push('/(tabs)/more/users/new')}>
                {t('accounts.create')}
              </Button>
            ) : null}
            {error ? <Text variant='caption'>{error}</Text> : null}
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.centered}>
              <Spinner />
            </View>
          ) : (
            <View style={styles.centered}>
              <Users size={36} />
              <Text variant='subtitle'>{t('accounts.empty')}</Text>
              <Text variant='caption'>{t('accounts.emptyBody')}</Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <ListRow
            title={item.displayName ?? item.email ?? item.id}
            subtitle={
              item.role === 'karykarta' && item.wardNo != null
                ? t('voters.ward', { no: item.wardNo }) +
                  // Multi-ward karykarta: the first ward plus "+N" for the
                  // rest — a suffix rather than a joined list so the row
                  // stays one line at any i18n width.
                  ((item.wardNos?.length ?? 1) > 1
                    ? ` +${(item.wardNos?.length ?? 1) - 1}`
                    : '')
                : t('settings.allWards')
            }
            meta={t(roleLabelKey(item.role))}
            tone={item.role === null ? 'danger' : 'primary'}
            // The reason a created account used to be invisible after the
            // moment of creation: Auth keeps only a password hash, so the one
            // screen that ever held the password was the create form, one
            // navigation ago. Tapping the account now reopens exactly that
            // information, from what this device filed at creation time.
            onPress={() => setSelected(item)}
            trailing={
              // No role is the state a super admin most needs to see at a
              // glance: the account exists, is signed in, and can do nothing.
              item.role === null ? (
                <Badge variant='destructive'>{t('role.none')}</Badge>
              ) : null
            }
          />
        )}
      />

      <AccountCredentialsModal
        profile={selected}
        revealPassword={canManage}
        onClose={() => setSelected(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 20, paddingBottom: 112, gap: 8 },
  header: { gap: 8, marginBottom: 12 },
  centered: { alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  denied: { alignItems: 'center', gap: 10 },
});