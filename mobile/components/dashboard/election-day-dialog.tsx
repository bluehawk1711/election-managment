import { AlertDialog } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useToast } from '@/components/ui/toast';
import { View } from '@/components/ui/view';
import { messageFor } from '@/lib/errors';
import { useReference } from '@/providers/reference-provider';
import { useColor } from '@/hooks/useColor';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

/**
 * Picks the one date the whole team counts down to.
 *
 * Three number fields rather than a date picker: this project has no picker
 * dependency, and adding a native one means a rebuild for everyone on a
 * campaign that is already out in the field. Day/month/year in three boxes is
 * also the shape a karykarta already fills on forms — nothing to learn.
 *
 * The date is written to `campaigns/active.electionDate` through
 * `reference.updateCampaign`, which every signed-in voter-reader is allowed to
 * do (see the `campaigns/$campaignId` write rule in database.rules.json), and
 * the dashboard banner reacts through the same node's live snapshot. Nothing
 * here is local: one campaign, one election day, one answer for everyone.
 *
 * A failed save keeps this dialog OPEN. `closeOnConfirm` is off for exactly
 * this reason — the app runs with a memory-only cache (lib/firebase.ts),
 * so a save that cannot reach the backend rejects rather than queueing, and a
 * dialog that closes on the reader the moment it fails turns "could not save"
 * into "did it save?".
 */
export function ElectionDayDialog({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const reference = useReference();
  const toast = useToast();
  const danger = useColor('error');

  const stored = reference.campaign?.electionDate ?? null;

  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Whether the fields are already filled from the last open — see below. */
  const [seeded, setSeeded] = useState(false);

  /**
   * Fill the fields when the dialog opens, from whatever is stored right now.
   *
   * Deliberately not an effect: React's render-phase "adjust state when a
   * prop changes" pattern (the one `useRoll` uses for its ward reset) keeps the
   * seed in the same pass as the open, so a fast tap never shows the previous
   * answer for a frame — and re-opening after another teammate moved the date
   * shows *their* date, not the one this device last saw.
   */
  if (visible !== seeded) {
    setSeeded(visible);
    if (visible) {
      const parts = dateParts(stored);
      setDay(parts.day);
      setMonth(parts.month);
      setYear(parts.year);
      setShowErrors(false);
    }
  }

  const dayNum = Number(day);
  const monthNum = Number(month);
  const yearNum = Number(year);
  // Round-trip through the Date constructor is the whole validation: it is
  // what turns "31 02 2027" (and every other overflowing pair) into an
  // answer that is not the date the user typed.
  const probe = new Date(yearNum, monthNum - 1, dayNum);
  const valid =
    day !== '' &&
    month !== '' &&
    year !== '' &&
    yearNum >= 2000 &&
    yearNum <= 2100 &&
    probe.getFullYear() === yearNum &&
    probe.getMonth() === monthNum - 1 &&
    probe.getDate() === dayNum;

  const write = async (electionDate: number | null, doneKey: 'election.saved' | 'election.cleared') => {
    setSaving(true);
    try {
      await reference.updateCampaign({ electionDate });
      toast.success(t(doneKey));
      onClose();
    } catch (caught) {
      // Still on screen — the reader retypes nothing, just presses Save again
      // when the connection is back.
      toast.error(t('election.failed'), messageFor(caught));
    } finally {
      setSaving(false);
    }
  };

  const save = () => {
    if (saving) return;
    if (!valid) {
      setShowErrors(true);
      return;
    }
    // Local noon, not midnight: a stored instant near the edge of a timezone
    // can round into the neighbouring day at midnight, and the countdown
    // (`daysBetween`) normalises both sides to local midnight anyway.
    void write(new Date(yearNum, monthNum - 1, dayNum, 12).getTime(), 'election.saved');
  };

  return (
    <AlertDialog
      isVisible={visible}
      onClose={onClose}
      title={t('election.title')}
      confirmText={saving ? t('election.pending') : t('common.save')}
      cancelText={t('common.cancel')}
      onConfirm={save}
      closeOnConfirm={false}
      dismissible={!saving}
    >
      <View style={styles.body}>
        <Text variant='caption'>{t('election.hint')}</Text>

        <View style={styles.row}>
          <Input
            label={t('election.day')}
            placeholder='DD'
            value={day}
            onChangeText={setDay}
            containerStyle={styles.cell}
            variant='outline'
            keyboardType='number-pad'
            maxLength={2}
          />
          <Input
            label={t('election.month')}
            placeholder='MM'
            value={month}
            onChangeText={setMonth}
            containerStyle={styles.cell}
            variant='outline'
            keyboardType='number-pad'
            maxLength={2}
          />
          <Input
            label={t('election.year')}
            placeholder='YYYY'
            value={year}
            onChangeText={setYear}
            containerStyle={styles.cell}
            variant='outline'
            keyboardType='number-pad'
            maxLength={4}
          />
        </View>

        {showErrors && !valid ? (
          <Text variant='caption' style={{ color: danger }}>
            {t('election.invalid')}
          </Text>
        ) : null}

        {/* Removing a date someone set is a real action, so it gets a control
            rather than needing three empty boxes and a Save — which the check
            above refuses anyway. */}
        {stored != null ? (
          <Button
            size='sm'
            variant='ghost'
            disabled={saving}
            onPress={() => void write(null, 'election.cleared')}
          >
            {t('election.clear')}
          </Button>
        ) : null}
      </View>
    </AlertDialog>
  );
}

/** Stored instant → the three strings the fields show; empty when unset. */
function dateParts(millis: number | null): {
  day: string;
  month: string;
  year: string;
} {
  if (millis == null) return { day: '', month: '', year: '' };
  const date = new Date(millis);
  return {
    day: String(date.getDate()),
    month: String(date.getMonth() + 1),
    year: String(date.getFullYear()),
  };
}

const styles = StyleSheet.create({
  body: { gap: 12 },
  row: { flexDirection: 'row', gap: 8 },
  // Three cells share the row; the day and month boxes are naturally narrow
  // and the year gets the slack, so YYYY never ellipsises inside its own box.
  cell: { flex: 1 },
});
