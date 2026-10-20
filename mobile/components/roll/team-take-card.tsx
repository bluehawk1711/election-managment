/**
 * "Save to my account" — the WRITE half of team sharing.
 *
 * Two accounts on the same team read each other's `voterEdits`
 * (firestore.rules `sameTeam`), and `useRoll` merges a teammate's entry
 * UNDER the local one, so the fields they filled in are already on screen.
 * What was missing is the second half of the workflow the campaign actually
 * runs in the field: one person collects a family's numbers at the door, the
 * other finishes the round later and needs those numbers on THEIR account
 * too — not as a credit to a colleague, but as data they can act on from
 * their own device, offline, without asking anyone for anything.
 *
 * That is this card. It copies the teammate's fields into the local overlay
 * (one `patchVoter`, the same path a single edit takes) and pushes, exactly
 * like any other edit made on this device. After it runs, the account owns
 * its own copy: `updatedBy` becomes this uid, the sync queue carries it, and
 * a later removal from the team cannot take the data away.
 *
 * Two rules the copy obeys, both inherited from `mergeVoter`:
 *
 *  - MY values win. A field this account has already recorded is never
 *    overwritten — the teammate fills gaps, they do not overrule. The merge
 *    already decided which fields those are (`VoterView.team` is only set
 *    when it contributes something new), so `takenPatch` reads the same
 *    difference rather than recomputing a different one.
 *  - `support` is NOT taken. Political profiling never leaves the device
 *    (`firestore.rules` rejects `support` on every writable collection), and
 *    a take that wrote it locally would be data the sync can never push —
 *    a silent lie about what is stored where.
 */
import { Chip } from '@/components/campaign/chip';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useToast } from '@/components/ui/toast';
import { View } from '@/components/ui/view';
import { useColor } from '@/hooks/useColor';
import { overlayStorage, patchVoter } from '@/lib/roll/overlay';
import { pushEdits } from '@/lib/roll/sync';
import { takenPatch, TAKE_KEYS, type TakeKey } from '@/lib/roll/team-take';
import type { VoterView } from '@/lib/roll/types';
import { Users } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

/** i18n key per taken field — the card names what it is about to copy.
 *
 * `as const satisfies` rather than a `Record<…, string>` annotation: the
 * annotation would widen each value to `string`, and `t()` takes the literal
 * union of this app's keys, not any string at all. */
const LABEL_KEY = {
  phone: 'common.phone',
  name: 'common.name',
  fatherOrHusbandName: 'voters.father',
  houseNo: 'voters.house',
  age: 'voters.age',
  gender: 'voters.gender',
  locality: 'voters.locality',
  jati: 'voters.jati',
  voted: 'voters.voted',
  leaning: 'voters.leaning',
  leaningNote: 'voters.leaningNote',
  note: 'voters.notes',
} as const satisfies Record<TakeKey, string>;

export function TeamTakeCard({
  voter,
  uid,
  wardNo,
  onTaken,
}: {
  voter: VoterView;
  /** The signed-in account — the patch is saved as ITS edit, not a credit. */
  uid: string;
  wardNo: number;
  onTaken: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const primary = useColor('primary');
  const outline = useColor('outline');
  const [busy, setBusy] = useState(false);

  const author = voter.team?.authorName ?? null;
  const patch = takenPatch(voter);

  // Nothing to take = nothing to render. `mergeVoter` only sets `team` when
  // it contributes a field this account lacks, so this is the same emptiness
  // the merge already checked — the card cannot appear over data that is
  // entirely this user's own.
  if (!voter.team || Object.keys(patch).length === 0) return null;

  const take = async () => {
    setBusy(true);
    try {
      await patchVoter(overlayStorage, {
        voterId: voter.id,
        wardNo,
        uid,
        patch,
      });
      // Same order as every other edit: the local overlay IS the save, the
      // push follows and reports its own failures.
      void pushEdits();
      toast.success(
        t('voters.teamTaken', { count: Object.keys(patch).length })
      );
      onTaken();
    } catch {
      toast.error(t('common.errorTitle'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <View style={[styles.iconBox, { backgroundColor: primary + '18' }]}>
          <Icon name={Users} size={15} color={primary} />
        </View>
        <Text variant='subtitle' numberOfLines={2} style={styles.headText}>
          {author
            ? t('voters.teamTakeTitle', { name: author })
            : t('voters.teamTakeTitleAnon')}
        </Text>
      </View>

      <Text variant='caption' style={{ color: outline }}>
        {t('voters.teamTakeIntro')}
      </Text>

      <View style={styles.chips}>
        {TAKE_KEYS.filter((key) => patch[key] !== undefined).map((key) => (
          <Chip key={key} label={t(LABEL_KEY[key])} tone='info' />
        ))}
      </View>

      <Button size='sm' loading={busy} onPress={() => void take()}>
        {t('voters.teamTakeAction')}
      </Button>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBox: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headText: { flex: 1, minWidth: 0 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});
