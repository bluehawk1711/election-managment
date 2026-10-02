import { ListRow } from '@/components/campaign/list-row';
import { SectionHeader } from '@/components/campaign/section-header';
import { Button } from '@/components/ui/button';
import { View } from '@/components/ui/view';
import { LucideProps } from 'lucide-react-native';

export type AttentionRow = {
  id: string;
  icon: React.ComponentType<LucideProps>;
  title: string;
  subtitle: string;
  meta: string;
  actionLabel: string;
  onPress: () => void;
  onAction: () => void;
};

type Props = {
  rows: AttentionRow[];
  title: string;
  countLabel: string;
  actionLabel: string;
  onAction: () => void;
};

/** "Needs attention" — derived action items with inline micro-actions. */
export function AttentionCard({ rows, title, countLabel, actionLabel, onAction }: Props) {
  return (
    <View style={{ gap: 12 }}>
      <SectionHeader
        title={title}
        subtitle={countLabel}
        actionLabel={actionLabel}
        onAction={onAction}
      />
      <View style={{ gap: 8 }}>
        {rows.map((row) => (
          <ListRow
            key={row.id}
            icon={row.icon}
            title={row.title}
            subtitle={row.subtitle}
            meta={row.meta}
            onPress={row.onPress}
            trailing={
              <Button size='sm' variant='outline' onPress={row.onAction}>
                {row.actionLabel}
              </Button>
            }
          />
        ))}
      </View>
    </View>
  );
}
