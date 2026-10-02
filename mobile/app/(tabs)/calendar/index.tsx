import { PlaceholderScreen } from '@/components/campaign/placeholder-screen';
import { CalendarDays } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

/** Calendar tab — agenda view and event modals land with the screens phase. */
export default function CalendarScreen() {
  const { t } = useTranslation();

  return <PlaceholderScreen title={t('nav.calendar')} icon={CalendarDays} />;
}
