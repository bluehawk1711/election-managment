import { SectionHeader } from '@/components/campaign/section-header';
import { Text } from '@/components/ui/text';
import { View } from '@/components/ui/view';
import { useColor } from '@/hooks/useColor';
import { BORDER_RADIUS } from '@/theme/globals';
import { typeStyle } from '@/theme/typography';
import { StyleSheet } from 'react-native';

export type ActivityRow = {
  id: string;
  name: string;
  initials: string;
  action: string;
  meta: string;
};

type Props = {
  rows: ActivityRow[];
  title: string;
  subtitle: string;
};

/** Recent activity — merged feed of task/expense/issue mutations. */
export function ActivityCard({ rows, title, subtitle }: Props) {
  const card = useColor('card');
  const border = useColor('border');
  const primary = useColor('secondary');
  const primaryText = useColor('primary');
  const outline = useColor('outline');

  return (
    <View style={{ gap: 12 }}>
      <SectionHeader title={title} subtitle={subtitle} />
      <View style={{ gap: 8 }}>
        {rows.map((row) => (
          <View
            key={row.id}
            style={[styles.row, { backgroundColor: card, borderColor: border }]}
          >
            <View style={[styles.avatar, { backgroundColor: primary }]}>
              <Text style={[typeStyle('labelSm'), { color: primaryText }]}>
                {row.initials}
              </Text>
            </View>
            <View style={styles.text}>
              <Text style={[typeStyle('bodyMd'), styles.name]} numberOfLines={1}>
                {row.name}
              </Text>
              <Text variant='caption' numberOfLines={1}>
                {row.action}
              </Text>
              <Text variant='caption' style={{ color: outline }} numberOfLines={1}>
                {row.meta}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: BORDER_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontWeight: '600',
  },
});
