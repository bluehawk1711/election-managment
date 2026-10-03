import { ThemedTabStack } from '@/components/nav/themed-tab-stack';
import { useTranslation } from 'react-i18next';

export default function TasksLayout() {
  const { t } = useTranslation();

  return (
    <ThemedTabStack
      screens={[
        { name: 'index', title: t('nav.tasks') },
        { name: '[id]', title: t('tasks.title') },
        { name: 'new', title: t('tasks.create'), presentation: 'modal' },
      ]}
    />
  );
}
