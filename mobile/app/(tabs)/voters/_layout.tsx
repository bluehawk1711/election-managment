import { ThemedTabStack } from '@/components/nav/themed-tab-stack';
import { useTranslation } from 'react-i18next';

/**
 * Voter roll stack: the list, one detail per voter, and the local-edit sheet
 * presented as a modal (plan-voters.md §6.1–6.3).
 */
export default function VotersLayout() {
  const { t } = useTranslation();

  return (
    <ThemedTabStack
      screens={[
        { name: 'index', title: t('voters.title') },
        { name: '[id]', title: t('voters.title') },
        { name: 'edit', title: t('voters.edit'), presentation: 'modal' },
      ]}
    />
  );
}
