import { ElectionDayDialog } from '@/components/dashboard/election-day-dialog';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { View } from '@/components/ui/view';
import { useColor } from '@/hooks/useColor';
import { electionCountdown } from '@/lib/election';
import { formatDate } from '@/lib/format';
import { useReference } from '@/providers/reference-provider';
import { Vote } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';

/**
 * The election-day banner: how long the campaign has, in one line, at the top
 * of the dashboard — and the picker for the date it counts to.
 *
 * Tap anywhere on it to change the date (any signed-in voter-reader may; see
 * `canEditCampaign()` in firestore.rules), which is why the whole card is a
 * button rather than a chevron on an otherwise inert surface: there is exactly
 * one thing to do here besides read the number.
 *
 * Four states, decided in `lib/election.ts` so Settings and this banner can
 * never disagree:
 *
 *   unset     "No election day set" + a way to take one
 *   future    "{{n}} days to voting day" — the countdown
 *   today     "Voting day", card tinted, no number anywhere near it
 *   passed    the date as a record ("Voting day was on …"), kept on screen
 *             rather than vanishing — the team may want to see it after the
 *             fact, and a banner that disappears reads as a bug.
 */
export function ElectionDayCard() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? i18n.language;
  const reference = useReference();
  const [pickerOpen, setPickerOpen] = useState(false);

  // Read once per mount, as the dashboard does: `Date.now()` belongs out of
  // the render body for purity, and the countdown changes in whole days.
  const [now] = useState(() => Date.now());

  const primary = useColor('primary');
  const outline = useColor('outline');
  const muted = useColor('muted');
  const foreground = useColor('foreground');

  const electionDate = reference.campaign?.electionDate ?? null;
  const state = electionCountdown(now, electionDate);

  const dateLabel =
    electionDate == null
      ? null
      : formatDate(electionDate, lang, {
          weekday: 'short',
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        });

  const headline =
    state.kind === 'unset'
      ? t('dash.electionUnset')
      : state.kind === 'today'
        ? t('dash.electionToday')
        : state.kind === 'passed'
          ? t('dash.electionPassed', { date: dateLabel ?? '' })
          : state.days === 1
            ? t('dash.electionTomorrow')
            : t('dash.electionDays', { days: state.days });

  const detail =
    state.kind === 'unset'
      ? t('dash.electionUnsetHint')
      : state.kind === 'passed'
        ? t('dash.electionAgo', { days: state.days })
        : (dateLabel ?? '');

  const isToday = state.kind === 'today';

  return (
    <>
      <Pressable
        onPress={() => setPickerOpen(true)}
        accessibilityRole='button'
        accessibilityLabel={`${t('dash.electionTitle')}: ${headline}`}
        style={({ pressed }) => (pressed ? { opacity: 0.8 } : null)}
      >
        <Card
          style={
            isToday
              ? // Voting day gets the campaign's own colour as the surface —
                // the one day on the calendar this whole app is built around,
                // and a card that looks identical to yesterday's would bury it.
                { backgroundColor: primary + '14', borderColor: primary }
              : undefined
          }
        >
          <View style={styles.row}>
            <View
              style={[
                styles.iconBox,
                { backgroundColor: isToday ? primary : muted },
              ]}
            >
              <Icon
                name={Vote}
                size={16}
                color={isToday ? '#fff' : foreground}
              />
            </View>

            <View style={styles.text}>
              <Text variant='caption' style={{ color: outline }}>
                {t('dash.electionTitle')}
              </Text>
              <Text variant='subtitle' numberOfLines={2}>
                {headline}
              </Text>
              <Text variant='caption' style={{ color: outline }} numberOfLines={2}>
                {detail}
              </Text>
            </View>

            {/* The card is the button; this says what pressing it does, so
                the banner is never a surface the reader has to guess at. */}
            <Text variant='caption' style={{ color: primary }}>
              {state.kind === 'unset'
                ? t('dash.electionSetAction')
                : t('dash.electionChangeAction')}
            </Text>
          </View>
        </Card>
      </Pressable>

      {/* Mounted permanently: the dialog runs its own close animation, and
          unmounting it here the instant `pickerOpen` flipped would cut that
          short. */}
      <ElectionDayDialog
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBox: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // `minWidth: 0` so a long date line wraps inside its own column instead of
  // pushing the action label off the right edge of the card.
  text: { flex: 1, minWidth: 0, gap: 2 },
});
