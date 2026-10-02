import { DonutChart } from '@/components/campaign/donut-chart';
import { SectionHeader } from '@/components/campaign/section-header';
import { View } from '@/components/ui/view';
import { useColor } from '@/hooks/useColor';
import type { TranslationKey } from '@/i18n/locales/en';
import type { IssueCategory } from '@/lib/models';
import { useTranslation } from 'react-i18next';

type Item = { category: IssueCategory; count: number };

type Props = {
  breakdown: Item[];
  subtitle: string;
  totalLabel: string;
  actionLabel?: string;
  onAction?: () => void;
};

const CATEGORY_KEY: Record<IssueCategory, TranslationKey> = {
  road: 'issues.cat.road',
  water: 'issues.cat.water',
  electricity: 'issues.cat.electricity',
  drainage: 'issues.cat.drainage',
  streetlight: 'issues.cat.streetlight',
  sanitation: 'issues.cat.sanitation',
};

/** Issues-by-category donut card for the dashboard. */
export function IssuesCard({ breakdown, subtitle, totalLabel, actionLabel, onAction }: Props) {
  const { t } = useTranslation();
  const blue = useColor('blue');
  const teal = useColor('teal');
  const orange = useColor('orange');
  const purple = useColor('purple');
  const yellow = useColor('yellow');
  const green = useColor('green');

  const palette: Record<IssueCategory, string> = {
    road: blue,
    water: teal,
    electricity: orange,
    drainage: purple,
    streetlight: yellow,
    sanitation: green,
  };

  const segments = breakdown.map((item) => ({
    label: t(CATEGORY_KEY[item.category]),
    value: item.count,
    color: palette[item.category],
  }));

  return (
    <View style={{ gap: 12 }}>
      <SectionHeader
        title={t('dash.issuesByCategory')}
        subtitle={subtitle}
        actionLabel={actionLabel}
        onAction={onAction}
      />
      <DonutChart segments={segments} totalLabel={totalLabel} />
    </View>
  );
}
