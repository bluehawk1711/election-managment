import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/campaign/select-field';
import { Input } from '@/components/ui/input';
import { ScrollView } from '@/components/ui/scroll-view';
import { Text } from '@/components/ui/text';
import { useToast } from '@/components/ui/toast';
import { View } from '@/components/ui/view';
import { useRoll } from '@/hooks/useRoll';
import { overlayStorage, patchVoter } from '@/lib/roll/overlay';
import type { Gender, SupportCategory, VoterView } from '@/lib/roll/types';
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
 * ## Why the form is its own component
 *
 * `useState` initialisers run **once, at mount** — they are not re-evaluated
 * when a value later arrives. The roll loads asynchronously, so on first mount
 * `roll.find(voterId)` is still `undefined` and every field would seed to
 * `''`. The screen then rendered its "no matching voters" placeholder, but
 * React kept the component (and its state) alive; when the row landed, the
 * form appeared **empty**, with `dirty` true — so saving would have written a
 * row of blanks over a real voter's name, father, house and age.
 *
 * Mounting the form only once the voter exists makes the initialisers read
 * real data, and remounting it per voter id (the `key` below) means switching
 * voters re-seeds rather than carrying the previous voter's values across.
 * Anything that seeds state from an async value has to be structured this way.
 */
export default function EditVoterScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; ward?: string }>();
  const voterId = String(params.id ?? '');
  const wardParam = Number(params.ward);

  // The ward MUST be passed to `useRoll` here, not left at the default
  // ("all wards", paged in batches of three). Without it `roll.find` only
  // searched the first three wards, so opening Edit for a voter in ward 4+
  // rendered "No matching voters" — the form for a voter who was right there
  // in the detail screen we came from.
  const roll = useRoll(
    Number.isFinite(wardParam) && wardParam > 0 ? wardParam : null
  );

  const voter = roll.find(voterId);
  const wardNo = voter?.wardNo ?? (Number.isFinite(wardParam) ? wardParam : null);

  if (!voter || wardNo == null) {
    // Still a loading state while the roll has nothing, a genuine miss
    // otherwise. The two are told apart by `loading` so a slow read does not
    // read as "this voter does not exist".
    return (
      <View style={styles.center}>
        {roll.loading ? (
          <Text variant='caption'>{t('common.loading')}</Text>
        ) : (
          <Text variant='caption'>{t('voters.noMatches')}</Text>
        )}
        <Button size='sm' variant='outline' onPress={() => router.back()}>
          {t('common.close')}
        </Button>
      </View>
    );
  }

  return (
    <EditForm
      key={voter.id}
      voter={voter}
      wardNo={wardNo}
      onSaved={roll.refresh}
    />
  );
}

/**
 * The editable form, mounted only once the voter is known.
 *
 * Takes the resolved `VoterView` rather than looking it up, so every field
 * below is initialised from real data on the first render and never has to
 * be re-synced afterwards.
 */
function EditForm({
  voter,
  wardNo,
  onSaved,
}: {
  voter: VoterView;
  wardNo: number;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();

  const base = voter.effective;

  // `?? ''` rather than `base.X`: an overlay-cleared field is legitimately
  // empty, and the form must show what is stored, not fall back to a base
  // value the user deliberately removed.
  const [name, setName] = useState(base.name ?? '');
  const [father, setFather] = useState(base.fatherOrHusbandName ?? '');
  const [houseNo, setHouseNo] = useState(base.houseNo ?? '');
  const [age, setAge] = useState(String(base.age ?? ''));
  const [gender, setGender] = useState<Gender>(base.gender ?? 'male');
  const [locality, setLocality] = useState(base.locality ?? '');
  const [phone, setPhone] = useState(base.phone ?? '');
  const [jati, setJati] = useState(base.jati ?? '');
  const [support, setSupport] = useState<SupportCategory>(
    voter.support ?? 'unknown'
  );
  const [note, setNote] = useState(voter.overlay.note ?? '');
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);

  const parsedAge = Number(age.trim());
  const ageValid =
    age.trim() !== '' &&
    Number.isInteger(parsedAge) &&
    parsedAge >= 18 &&
    parsedAge <= 100;

  /**
   * Whether anything has actually changed.
   *
   * `base` is now the resolved voter, not an optional lookup, so this cannot
   * be permanently `false` while the row loads — the version that compared
   * against `voter?.effective.X ?? ''` left Save disabled for every keystroke
   * typed before the row arrived.
   */
  const dirty =
    name !== (base.name ?? '') ||
    father !== (base.fatherOrHusbandName ?? '') ||
    houseNo !== (base.houseNo ?? '') ||
    String(base.age ?? '') !== age.trim() ||
    gender !== (base.gender ?? 'male') ||
    locality !== (base.locality ?? '') ||
    phone !== (base.phone ?? '') ||
    jati !== (base.jati ?? '') ||
    support !== (voter.support ?? 'unknown') ||
    (voter.overlay.note ?? '') !== note;

  const submit = async () => {
    if (!ageValid) {
      setShowErrors(true);
      return;
    }

    setSaving(true);
    try {
      const current = voter.effective;
      await patchVoter(overlayStorage, {
        voterId: voter.id,
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
      onSaved();
      toast.success(t('voters.savedLocally'));
      router.back();
    } catch {
      toast.error(t('common.errorTitle'));
    } finally {
      setSaving(false);
    }
  };

  return (
    // The bounded `View` is the actual fix, not decoration on the ScrollView.
    // As the bare root of a screen inside a `presentation: 'modal'` stack,
    // the ScrollView relied on the scene stretching it to a bounded height —
    // which it does not do reliably on Android — so it laid out at its full
    // content height and never became scrollable. Every screen in this app
    // that scrolls wraps one (see `booths/index.tsx`), and this is the only
    // one that did not.
    <View style={styles.fill}>
      <ScrollView
        style={styles.fill}
        // `flexGrow: 1` lets a *short* form still fill the viewport, so the
        // Save button sits at the bottom edge rather than floating mid-screen
        // on a tall device. `gap` stays on the content style.
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
        // `type='textarea'`, not a raw `multiline` prop: `Input` switches its
        // whole layout (stacked label, `rows` line-height, top-aligned text)
        // off that prop. Passing `multiline` alone left it rendered as a
        // single-line row with the text vertically centred, which is not a
        // notes field.
        type='textarea'
        rows={4}
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
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // `flexGrow: 1` on the content container — see the note at the ScrollView.
  body: { flexGrow: 1, padding: 20, paddingBottom: 48, gap: 14 },
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