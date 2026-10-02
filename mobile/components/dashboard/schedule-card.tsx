import { DateChip } from '@/components/campaign/date-chip';
import { SectionHeader } from '@/components/campaign/section-header';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { View } from '@/components/ui/view';
import { useColor } from '@/hooks/useColor';
import { formatTime } from '@/lib/format';
import type { CampaignEvent, EventType } from '@/lib/models';
import { BORDER_RADIUS } from '@/theme/globals';
import { typeStyle } from '@/theme/typography';
import { ChevronRight, Flag, LucideProps, Megaphone, ShieldCheck, Users } from 'lucide-react-native';
import { Pressable, StyleSheet } from 'react-native';

const TYPE_ICON: Record<EventType, React.ComponentType<LucideProps>> = {
  meeting: Users,
  training: ShieldCheck,
  public: Megaphone,
  deadline: Flag,
};

type Props = {
  events: CampaignEvent[];
  title: string;
  subtitle: string;
  locationLabel: string;
  onSelect: (id: string) => void;
  onAll?: () => void;
  allLabel?: string;
};

/** Upcoming schedule — next three events with date chips. */
export function ScheduleCard({ events, title, subtitle, locationLabel, onSelect, onAll, allLabel }: Props) {
  const card = useColor('card');
  const border = useColor('border');
  const outline = useColor('outline');

  return (
    <View style={{ gap: 12 }}>
      <SectionHeader title={title} subtitle={subtitle} actionLabel={allLabel} onAction={onAll} />
      <View style={{ gap: 8 }}>
        {events.map((event) => (
          <Pressable
            key={event.id}
            onPress={() => onSelect(event.id)}
            accessibilityRole='button'
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: card, borderColor: border, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <DateChip millis={event.startsAt} />
            <View style={styles.text}>
              <Text numberOfLines={1} style={[typeStyle('bodyLg'), styles.title]}>
                {event.title}
              </Text>
              <View style={styles.meta}>
                <Icon name={TYPE_ICON[event.type]} size={13} color={outline} />
                <Text variant='caption' numberOfLines={1} style={{ color: outline }}>
                  {formatTime(event.startsAt)} · {event.location || locationLabel}
                </Text>
              </View>
            </View>
            <Icon name={ChevronRight} size={18} color={outline} />
          </Pressable>
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
  text: {
    flex: 1,
    gap: 3,
  },
  title: {
    fontWeight: '600',
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
});
