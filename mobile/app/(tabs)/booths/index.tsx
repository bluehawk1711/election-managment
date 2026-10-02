import { PlaceholderScreen } from '@/components/campaign/placeholder-screen';
import { Vote } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

/** Booths tab — list + hierarchy filters land with the screens phase. */
export default function BoothsScreen() {
  const { t } = useTranslation();

  return <PlaceholderScreen title={t('nav.booths')} icon={Vote} />;
}
