import { ThemedTabStack } from '@/components/nav/themed-tab-stack';
import { useTranslation } from 'react-i18next';

/**
 * More hub stack: the grid (`index`) plus the modules that live behind it —
 * settings, tasks and calendar (which stopped being tabs in the voter-roll
 * build so the bar could carry Voters and Reports), and Accounts for a super
 * admin.
 *
 * ## Why `tasks` and `calendar` have `headerShown: false`
 *
 * Both of those directories contain their **own** `_layout.tsx` with their own
 * `ThemedTabStack`, so they already render a full header (large title, back
 * button, blur). Declaring them here *as well* gave each screen two headers
 * stacked on top of each other: the outer one said "Tasks" and the inner one
 * said "Tasks" again, and on the create-task modal the same thing happened with
 * a third — which is what read as "double header" on New Task and Calendar.
 *
 * React Navigation does not hide an ancestor header just because a descendant
 * stack has one; the outer screen has to opt out explicitly. The title is kept
 * on the declaration anyway so the route still has a name for back navigation
 * and for the accessibility tree, which does not depend on the header being
 * visible.
 *
 * The same applies to `settings/index` and `users/*`: they are plain screens in
 * this stack with no nested layout, so they keep their header here.
 */
export default function MoreLayout() {
  const { t } = useTranslation();

  return (
    <ThemedTabStack
      screens={[
        { name: 'index', title: t('nav.more') },
        // Nested stacks — they render their own headers.
        { name: 'tasks', title: t('nav.tasks'), headerShown: false },
        { name: 'calendar', title: t('nav.calendar'), headerShown: false },
        { name: 'users/index', title: t('accounts.title') },
        { name: 'users/new', title: t('accounts.create'), presentation: 'modal' },
        { name: 'issues/index', title: t('more.issues') },
        { name: 'issues/new', title: t('more.newIssue'), presentation: 'modal' },
        { name: 'expenses/index', title: t('more.expenses') },
        { name: 'expenses/new', title: t('more.newExpense'), presentation: 'modal' },
        { name: 'settings/index', title: t('settings.title') },
        { name: 'help', title: t('more.help') },
      ]}
    />
  );
}