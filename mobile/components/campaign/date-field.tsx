import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { View } from '@/components/ui/view';
import { useColor } from '@/hooks/useColor';
import { addDays, monthGrid, startOfMonth } from '@/lib/dates';
import { formatDate } from '@/lib/format';
import { CONTROL_RADIUS, CORNERS } from '@/theme/globals';
import { typeStyle } from '@/theme/typography';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet } from 'react-native';

type Props = {
  value: number | null;
  onChange: (millis: number) => void;
  label?: string;
};

/** Press-to-open month calendar card — no native date-picker dependency. */
export function DateField({ value, onChange, label }: Props) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => value ?? Date.now());

  const card = useColor('card');
  const border = useColor('border');
  const outline = useColor('outline');
  const text = useColor('text');
  const primary = useColor('primary');
  const onPrimary = useColor('primaryForeground');

  const grid = useMemo(() => monthGrid(cursor), [cursor]);
  const monthLabel = formatDate(cursor, i18n.language, { month: 'long', year: 'numeric' });

  const weekdayKeys = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole='button'
        style={[styles.field, { backgroundColor: card, borderColor: border }]}
      >
        <View style={styles.fieldText}>
          {label ? (
            <Text variant='caption' style={{ color: outline }}>
              {label}
            </Text>
          ) : null}
          <Text style={typeStyle('bodyMd')}>
            {value
              ? formatDate(value, i18n.language, { day: '2-digit', month: 'short', year: 'numeric' })
              : t('common.date')}
          </Text>
        </View>
        <Icon name={CalendarDays} size={18} color={outline} />
      </Pressable>

      <Modal visible={open} transparent animationType='fade' onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable
            style={[styles.calendar, { backgroundColor: card, borderColor: border }]}
            onPress={() => {}}
          >
            <View style={styles.monthRow}>
              <Pressable
                onPress={() => setCursor(addDays(startOfMonth(cursor), -1))}
                hitSlop={8}
                accessibilityLabel={t('common.back')}
              >
                <Icon name={ChevronLeft} size={20} />
              </Pressable>
              <Text style={typeStyle('headlineSm')}>{monthLabel}</Text>
              <Pressable
                onPress={() => setCursor(addDays(startOfMonth(cursor), 33))}
                hitSlop={8}
                accessibilityLabel={t('common.next')}
              >
                <Icon name={ChevronRight} size={20} />
              </Pressable>
            </View>

            <View style={styles.weekRow}>
              {weekdayKeys.map((day) => (
                <Text key={day} variant='caption' style={[styles.weekday, { color: outline }]}>
                  {t(`common.weekdays.${day}`)}
                </Text>
              ))}
            </View>

            <View style={styles.grid}>
              {grid.map((day) => {
                const inMonth = new Date(day).getMonth() === new Date(cursor).getMonth();
                const selected = value != null && day === value;
                return (
                  <Pressable
                    key={day}
                    onPress={() => {
                      onChange(day);
                      setOpen(false);
                    }}
                    style={[
                      styles.day,
                      selected ? { backgroundColor: primary } : null,
                    ]}
                    accessibilityRole='button'
                    accessibilityState={{ selected }}
                  >
                    <Text
                      style={[
                        typeStyle('labelMd'),
                        styles.dayText,
                        { color: selected ? onPrimary : inMonth ? text : outline },
                      ]}
                    >
                      {new Date(day).getDate()}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.footer}>
              <Pressable
                onPress={() => {
                  onChange(startOfDayNow());
                  setOpen(false);
                }}
                hitSlop={8}
              >
                <Text style={[typeStyle('labelMd'), { color: primary }]}>{t('common.today')}</Text>
              </Pressable>
              <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                <Text style={[typeStyle('labelMd'), { color: outline }]}>{t('common.close')}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function startOfDayNow(): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.getTime();
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: CONTROL_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
  },
  fieldText: {
    gap: 2,
    flex: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  calendar: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 12,
  },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  weekRow: {
    flexDirection: 'row',
  },
  weekday: {
    width: `${100 / 7}%`,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  day: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: CORNERS,
  },
  dayText: {
    textAlign: 'center',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
});
