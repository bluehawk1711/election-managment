import { PlaceholderScreen } from '@/components/campaign/placeholder-screen';
import { SlidersHorizontal } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

/** More hub — the grid of secondary modules lands with the screens phase. */
export default function MoreScreen() {
  const { t } = useTranslation();

  return <PlaceholderScreen title={t('nav.more')} icon={SlidersHorizontal} />;
}
