import { ThemedTabStack } from '@/components/nav/themed-tab-stack';
import { useTranslation } from 'react-i18next';

/** Booth report stack — one screen today, drill-down later. */
export default function ReportsLayout() {
  const { t } = useTranslation();

  return <ThemedTabStack screens={[{ name: 'index', title: t('reports.title') }]} />;
}
