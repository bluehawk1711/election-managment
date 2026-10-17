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
import { can, roleLabelKey } from '@/lib/roles';
import { useAuth } from '@/providers/auth-provider';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import { useRouter } from 'expo-router';
import { ShieldOff, UserCog, Users } from 'lucide-react-native';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet } from 'react-native';

/**
 * Firestore document → `Profile`, for `useCollection`.
 *
 * A module-level function, not an inline arrow: `useCollection` takes `mapDoc`
 * in its dependency array, so an inline mapper would tear down and resubscribe
 * the `onSnapshot` on every single render.
 */
const toProfile = (doc: QueryDocumentSnapshot<DocumentData>): Profile | null =>
  profileFromDoc(doc);

/**
 * Accounts list (plan-voters.md §6.5).
 *
 * Runs on `useCollection`, which is `onSnapshot` + `includeMetadataChanges` — so
 * a role granted on one device shows up here without a refetch. That matters
 * more than usual here, because the most common reason to open this screen is
 * "did my change to someone's role land?", and a screen that needs a manual
 * reload to answer that invites the reader to reload manually.
 *
 * `firestore.rules` denies the `users` list to anyone without `accountView`,
 * so the gate below is a convenience: it stops a karykarta opening a screen
 * that could only ever error, and lets it say why rather than show a red box.
 *
 * **View vs manage.** The roster is viewable by `accountView` (admin upward) —
 * an admin has to be able to see the team a super admin created — while the
 * Create button demands `accountManage` (super admin upward), matching the two
 * rule helpers. An admin therefore reads this screen in full and simply has no
 * create button; nothing hidden-but-broken.
 *
 * Sorted in memory rather than with `orderBy`: `displayName` is optional, and
 * Firestore drops documents missing an ordered field — so `orderBy('displayName')`
 * would silently hide every account created through a provider that does not
 * supply one. That is the exact failure mode `firestore.indexes.json` cannot
 * save you from, and `firestore.rules` §3 warns about in its own comments.
 */
export default function UsersScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { profile } = useAuth();

  const canView = can(profile?.role ?? null, 'accountView');
  const canManage = can(profile?.role ?? null, 'accountManage');

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
                has no create button — the same split as the rules. */}
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
                ? t('voters.ward', { no: item.wardNo })
                : t('settings.allWards')
            }
            meta={t(roleLabelKey(item.role))}
            tone={item.role === null ? 'danger' : 'primary'}
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