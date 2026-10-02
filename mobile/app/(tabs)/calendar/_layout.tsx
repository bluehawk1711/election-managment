import { ThemedTabStack } from '@/components/nav/themed-tab-stack';
import { useTranslation } from 'react-i18next';

export default function CalendarLayout() {
  const { t } = useTranslation();

  return (
    <ThemedTabStack screens={[{ name: 'index', title: t('nav.calendar') }]} />
  );
}
