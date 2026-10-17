import { ListRow } from '@/components/campaign/list-row';
import { BrandLogo } from '@/components/brand/brand-logo';
import { ScrollView } from '@/components/ui/scroll-view';
import { Separator } from '@/components/ui/separator';
import { Text } from '@/components/ui/text';
import { View } from '@/components/ui/view';
import { can, roleLabelKey } from '@/lib/roles';
import { useAuth } from '@/providers/auth-provider';
import { useTranslation } from 'react-i18next';
import {
  CalendarDays,
  ClipboardList,
  LucideProps,
  Settings,
  UserCog,
} from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';

/**
 * More hub — the grid of secondary modules (plan-voters.md §6.6).
 *
 * Voted on the client's `can(role, capability)` rather than on a role string,
 * so the grid and `firestore.rules` cannot drift: both read the same vocabulary
 * from `lib/roles.ts`, and a capability that does not exist yet cannot be
 * rendered without adding it there.
 *
 * The important case is Accounts. It is hidden entirely from anyone without
 * `accountView` rather than shown and then refused — the route exists for
 * every signed-in user, so a visible-but-broken entry is worse than an absent
 * one. Viewing the roster is admin-and-above; the create button inside the
 * screen is harder (`accountManage`), and `firestore.rules` matches both, so a
 * grid entry can never promise a write the rules deny.
 */
interface HubEntry {
  key: string;
  title: string;
  hint?: string;
  icon: React.ComponentType<LucideProps>;
  /** Medallion tint — each module gets its own colour so the hub scans by colour, not by reading every label. */
  tone: 'primary' | 'danger' | 'warning' | 'info' | 'success';
  href:
    | '/(tabs)/more/tasks'
    | '/(tabs)/more/calendar'
    | '/(tabs)/more/users'
    | '/(tabs)/more/settings';
}

export default function MoreScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { profile } = useAuth();

  const role = profile?.role ?? null;

  const entries: HubEntry[] = [
    {
      key: 'tasks',
      title: t('nav.tasks'),
      icon: ClipboardList,
      tone: 'primary',
      href: '/(tabs)/more/tasks',
    },
    {
      key: 'calendar',
      title: t('nav.calendar'),
      icon: CalendarDays,
      tone: 'info',
      href: '/(tabs)/more/calendar',
    },
    {
      key: 'accounts',
      title: t('more.accounts'),
      hint: t('more.accountsHint'),
      icon: UserCog,
      tone: 'success',
      href: '/(tabs)/more/users',
    },
    {
      key: 'settings',
      title: t('more.settings'),
      hint: t('more.settingsHint'),
      icon: Settings,
      tone: 'warning',
      href: '/(tabs)/more/settings',
    },
  ];

  // `canVoters` for the content modules; `accountView` (admin and above) for
  // Accounts: a user with no role at all should see Settings (to fix their
  // language and read what is wrong) but not an empty Tasks list they cannot
  // write to — and an admin should see the team roster a super admin created.
  const canVoters = can(role, 'voterRead');
  const canAccounts = can(role, 'accountView');
  const visible = entries.filter((entry) =>
    entry.key === 'accounts' ? canAccounts : entry.key === 'settings' || canVoters
  );

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{
        padding: 20,
        paddingTop: 8,
        gap: 12,
        // The floating tab bar is an absolute overlay and contributes no
        // height to this column, so every scroll container under `(tabs)` has
        // to reserve room for it itself. The other four screens use 112; this
        // one was missing it entirely, which put the last entry underneath the
        // pill.
        paddingBottom: 112,
      }}
    >
      {/* The role is shown here rather than only in Settings because it is the
          single fact that explains why some entries are missing. A karykarta
          who cannot find Accounts deserves to be told why without hunting. */}
      <View style={styles.brand}>
        <BrandLogo size={72} />
        <View style={{ gap: 4 }}>
          <Text variant='subtitle'>{t('app.name')}</Text>
          <Text variant='caption'>{t('app.tagline')}</Text>
        </View>
      </View>

      <View style={{ paddingBottom: 4 }}>
        <Text variant='caption'>{t('settings.yourRole')}</Text>
        <Text variant='subtitle'>{t(roleLabelKey(role))}</Text>
      </View>

      <Separator />

      {visible.map((entry) => (
        <ListRow
          key={entry.key}
          title={entry.title}
          subtitle={entry.hint}
          icon={entry.icon}
          tone={entry.tone}
          onPress={() => router.push(entry.href)}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingBottom: 8 },
});