import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectField } from '@/components/campaign/select-field';
import { ScrollView } from '@/components/ui/scroll-view';
import { Text } from '@/components/ui/text';
import { useToast } from '@/components/ui/toast';
import { View } from '@/components/ui/view';
import { useRoll } from '@/hooks/useRoll';
import { overlayStorage, patchVoter } from '@/lib/roll/overlay';
import type { Gender, SupportCategory } from '@/lib/roll/types';
import { useAuth } from '@/providers/auth-provider';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

const GENDERS: Gender[] = ['male', 'female', 'other'];
const SUPPORTS: SupportCategory[] = ['unknown', 'supporter', 'opponent'];

/** i18n key for one support value (`voters.support.supporter`, …). */
const supportKey = (value: SupportCategory) => `voters.support.${value}` as const;

/**
 * Local-edit sheet (plan-voters.md §6.3).
 *
 * Writes only to the overlay — the "base roll is read-only" rule. Nothing
 * here calls Firestore, so the save works offline by construction and the
 * queued entry is what a later sync will push.
 *
 * `undefined` for an untouched field is what keeps a partial form from
 * erasing values it did not render; an empty string still clears, because the
 * user typed it.
 */
export default function EditVoterScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ id: string; ward?: string }>();
  const voterId = String(params.id ?? '');
  const wardParam = Number(params.ward);

  // The ward MUST be passed to `useRoll` here, not left at the default
  // ("all wards", paged in batches of three). Without it `roll.find` only
  // searched the first three wards, so opening Edit for a voter in ward 4+
  // rendered "No matching voters" — the form for a voter who was right there
  // in the detail screen we came from.
  const roll = useRoll(Number.isFinite(wardParam) && wardParam > 0 ? wardParam : null);

  const voter = roll.find(voterId);
  const wardNo = voter?.wardNo ?? (Number.isFinite(wardParam) ? wardParam : null);

  const [name, setName] = useState(voter?.effective.name ?? '');
  const [father, setFather] = useState(voter?.effective.fatherOrHusbandName ?? '');
  const [houseNo, setHouseNo] = useState(voter?.effective.houseNo ?? '');
  const [age, setAge] = useState(String(voter?.effective.age ?? ''));
  const [gender, setGender] = useState<Gender>(voter?.effective.gender ?? 'male');
  const [locality, setLocality] = useState(voter?.effective.locality ?? '');
  const [phone, setPhone] = useState(voter?.effective.phone ?? '');
  const [jati, setJati] = useState(voter?.effective.jati ?? '');
  const [support, setSupport] = useState<SupportCategory>(
    voter?.support ?? 'unknown'
  );
  const [note, setNote] = useState(voter?.overlay.note ?? '');
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);

  const parsedAge = Number(age.trim());
  const ageValid =
    age.trim() !== '' && Number.isInteger(parsedAge) && parsedAge >= 18 && parsedAge <= 100;

  /**
   * Whether anything has actually changed.
   *
   * Every field is compared against `voter?.effective.X ?? ''` rather than
   * behind a `voter ? … : false` guard. The guard made `dirty` permanently
   * `false` while the row was still loading, which left the Save button
   * disabled no matter what was typed — the form looked editable and silently
   * refused to save. That is the "I can't add a number" report: the phone
   * field was fine, the button was not.
   */
  const base = voter?.effective;
  const dirty =
    name !== (base?.name ?? '') ||
    father !== (base?.fatherOrHusbandName ?? '') ||
    houseNo !== (base?.houseNo ?? '') ||
    String(base?.age ?? '') !== age.trim() ||
    gender !== (base?.gender ?? 'male') ||
    locality !== (base?.locality ?? '') ||
    phone !== (base?.phone ?? '') ||
    jati !== (base?.jati ?? '') ||
    support !== (voter?.support ?? 'unknown') ||
    (voter?.overlay.note ?? '') !== note;

  const submit = async () => {
    if (!ageValid) {
      setShowErrors(true);
      return;
    }
    if (!voter || wardNo == null) {
      // Used to return in silence, so tapping Save with the row still loading
      // did nothing at all — no write, no message, no way to tell it apart
      // from a broken button.
      toast.error(t('voters.errorBody'));
      return;
    }

    setSaving(true);
    try {
      const current = voter.effective;
      await patchVoter(overlayStorage, {
        voterId,
        wardNo,
        uid: user?.uid ?? 'local',
        patch: {
          // Only send what actually moved — `patchVoter` no-ops otherwise, so
          // opening the sheet and saving does not queue a phantom change.
          ...(name !== current.name ? { name: name.trim() } : {}),
          ...(father !== current.fatherOrHusbandName
            ? { fatherOrHusbandName: father.trim() }
            : {}),
          ...(houseNo !== current.houseNo ? { houseNo: houseNo.trim() } : {}),
          ...(String(current.age) !== age.trim() ? { age: parsedAge } : {}),
          ...(gender !== current.gender ? { gender } : {}),
          ...(locality !== current.locality ? { locality: locality.trim() } : {}),
          ...(phone !== current.phone ? { phone: phone.trim() } : {}),
          ...(jati !== current.jati ? { jati: jati.trim() } : {}),
          ...(support !== (voter.support ?? 'unknown') ? { support } : {}),
          ...((voter.overlay.note ?? '') !== note ? { note } : {}),
        },
      });
      roll.refresh();
      toast.success(t('voters.savedLocally'));
      router.back();
    } catch {
      toast.error(t('common.errorTitle'));
    } finally {
      setSaving(false);
    }
  };

  if (!voter) {
    return (
      <View style={styles.center}>
        <Text variant='caption'>{t('voters.noMatches')}</Text>
        <Button size='sm' variant='outline' onPress={() => router.back()}>
          {t('common.close')}
        </Button>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.body}
      keyboardShouldPersistTaps='handled'
    >
      <Text variant='caption'>{t('voters.editHint')}</Text>

      <Input
        label={t('common.name')}
        value={name}
        onChangeText={setName}
        placeholder={t('common.name')}
      />
      <Input
        label={t('voters.father')}
        value={father}
        onChangeText={setFather}
        placeholder={t('voters.father')}
      />
      <Input
        label={t('voters.house')}
        value={houseNo}
        onChangeText={setHouseNo}
        placeholder={t('voters.house')}
      />
      <Input
        label={t('voters.age')}
        value={age}
        onChangeText={setAge}
        keyboardType='number-pad'
        error={showErrors && !ageValid ? t('voters.ageInvalid') : undefined}
      />

      <View style={styles.genderRow}>
        {GENDERS.map((value) => {
          const active = gender === value;
          return (
            <Button
              key={value}
              size='sm'
              variant={active ? 'default' : 'outline'}
              style={styles.genderButton}
              onPress={() => setGender(value)}
            >
              {value}
            </Button>
          );
        })}
      </View>

      <Input
        label={t('voters.locality')}
        value={locality}
        onChangeText={setLocality}
        placeholder={t('voters.locality')}
      />
      <Input
        label={t('common.phone')}
        value={phone}
        onChangeText={setPhone}
        keyboardType='phone-pad'
        placeholder={t('voters.phoneHint')}
      />
      <Input
        label={t('voters.jati')}
        value={jati}
        onChangeText={setJati}
        placeholder={t('voters.jatiPlaceholder')}
      />
      <SelectField
        label={t('voters.support')}
        value={support}
        placeholder={t('voters.support.unknown')}
        options={SUPPORTS.map((value) => ({
          value,
          label: t(supportKey(value)),
        }))}
        onChange={(value) => setSupport(value as SupportCategory)}
      />
      <Input
        label={t('voters.notes')}
        value={note}
        onChangeText={setNote}
        multiline
        placeholder={t('voters.notesPlaceholder')}
      />

      <Button
        onPress={() => void submit()}
        loading={saving}
        disabled={saving || !dirty}
      >
        {t('common.save')}
      </Button>
      {!dirty ? (
        <Text variant='caption' style={styles.hint}>
          {t('voters.noChanges')}
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 20, paddingBottom: 48, gap: 14 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 20,
  },
  genderRow: { flexDirection: 'row', gap: 8 },
  genderButton: { flex: 1, textTransform: 'capitalize' },
  hint: { textAlign: 'center' },
});
