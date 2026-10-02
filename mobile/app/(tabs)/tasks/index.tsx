import { PlaceholderScreen } from '@/components/campaign/placeholder-screen';
import { ListChecks } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

/** Tasks tab — status pills, filters and detail stack land with the screens phase. */
export default function TasksScreen() {
  const { t } = useTranslation();

  return <PlaceholderScreen title={t('nav.tasks')} icon={ListChecks} />;
}
