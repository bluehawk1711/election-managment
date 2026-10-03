import { ThemedTabStack } from '@/components/nav/themed-tab-stack';
import { useTranslation } from 'react-i18next';

/**
 * More hub stack: the grid (`index`) plus the modules that live behind it —
 * settings, tasks and calendar (which stopped being tabs in the voter-roll
 * build so the bar could carry Voters and Reports), and Accounts for a super
 * admin.
 */
export default function MoreLayout() {
  const { t } = useTranslation();

  return (
    <ThemedTabStack
      screens={[
        { name: 'index', title: t('nav.more') },
        // `tasks` and `calendar` carry their own nested stacks.
        { name: 'tasks', title: t('nav.tasks') },
        { name: 'calendar', title: t('nav.calendar') },
        { name: 'users/index', title: t('accounts.title') },
        { name: 'users/new', title: t('accounts.create'), presentation: 'modal' },
        // The settings screen renders inside this stack, so its own header
        // is the previous nested layout — no separate settings layout.
        { name: 'settings/index', title: 'Settings' },
      ]}
    />
  );
}
