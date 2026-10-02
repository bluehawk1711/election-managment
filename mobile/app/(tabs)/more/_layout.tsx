import { ThemedTabStack } from '@/components/nav/themed-tab-stack';
import { useTranslation } from 'react-i18next';

/**
 * More hub stack: the grid (`index`) plus the modules that live behind it —
 * settings today (voters/team/issues/expenses/compliance join with the
 * screens phase, declared here as they arrive).
 */
export default function MoreLayout() {
  const { t } = useTranslation();

  return (
    <ThemedTabStack
      screens={[
        { name: 'index', title: t('nav.more') },
        // The settings screen renders inside this stack, so its own header
        // is the previous nested layout — no separate settings layout.
        { name: 'settings/index', title: 'Settings' },
      ]}
    />
  );
}
