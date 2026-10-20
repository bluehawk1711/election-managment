/**
 * Bulk phone update (user demand #8, entry styles):
 *
 *   1. **Tick rows** — long-press in the list, tap “Bulk phone”; the ticked
 *      ids arrive here as the `ids` param. This is the MAIN flow and it asks
 *      for one thing only: a phone number. No voter id, no EPIC — the people
 *      are already on screen with their photo and name, so typing an id to
 *      say "these ones" would be asking for what the selection already said.
 *      The number is typed ONCE and fills every row (the old single-field
 *      bulk entry), and each row stays editable afterwards.
 *   2. **Whole house** — the button on the edit sheet next to the phone field
 *      (`applyToHouse` there), which needs no screen and applies to exactly
 *      what is typed. This screen is its sibling, not its duplicate.
 *   3. **Paste an EPIC list** — OPTIONAL, kept below for the sheet a volunteer
 *      is handed from the field: `EPIC, phone` per line. It is never the only
 *      way in; anyone who has ticked rows never needs it. Digits and
 *      separators are normalised loosely (comma / tab / colon / semicolon /
 *      space all split), because the list is always typed or pasted from
 *      somewhere else and strict parsing would make half of it fail silently.
 *
 * Every write goes through `patchVoter` like a single edit — so base-roll
 * immutability, the pending-sync queue and (now) the Firestore push all keep
 * working with no bulk-specific code path to drift.
 *
 * The roll is loaded `eager` (all 13 wards) on purpose: ticked ids and pasted
 * EPICs must resolve regardless of which ward the list screen was showing.
 */
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Image } from '@/components/ui/image';
import { Input } from '@/components/ui/input';
import { ScrollView } from '@/components/ui/scroll-view';
import { Spinner } from '@/components/ui/spinner';
import { Text } from '@/components/ui/text';
import { useToast } from '@/components/ui/toast';
import { View } from '@/components/ui/view';
import { useColor } from '@/hooks/useColor';
import { useRoll } from '@/hooks/useRoll';
import { overlayStorage, patchVoter } from '@/lib/roll/overlay';
import { isValidPhone } from '@/lib/roll/contacts';
import { writeProposal } from '@/lib/roll/contacts-store';
import { rollPhotoAsset } from '@/lib/roll/photos';
import { pushEdits } from '@/lib/roll/sync';
import type { VoterView } from '@/lib/roll/types';
import { useAuth } from '@/providers/auth-provider';
import { UserX } from 'lucide-react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

/** A line of a pasted list, resolved as far as it could be. */
interface ParsedLine {
  epic: string;
  phone: string;
  voter: VoterView | null;
}

/**
 * `EPIC<sep>phone` → the two halves, or `null` when the line cannot be read.
 *
 * Split on any run of non-EPIC separators rather than only `,`: pasted lists
 * come out of messaging apps and spreadsheets with tabs, colons and double
 * spaces, and rejecting those would look like data loss to the user.
 */
function parseLine(raw: string): { epic: string; phone: string } | null {
  const parts = raw.split(/[\s,;:\t]+/).filter(Boolean);
  if (parts.length < 2) return null;
  const epic = parts[0].toUpperCase();
  const phone = parts[1];
  // EPIC ids: 3 letters + 7 digits, or the old RJ/xx/xxx/xxxxxx form. Loose
  // enough to accept a lowercase paste (uppercased above), strict enough that
  // a stray sentence line does not silently target a random voter.
  if (!/^[A-Z]{3}\d{7}$/.test(epic) && !/^RJ\/\d{2}\/\d{3}\/\d{6}$/.test(epic)) {
    return null;
  }
  if (!/\d{10}/.test(phone)) return null;
  return { epic, phone };
}

export default function BulkPhoneScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const { user, profile } = useAuth();

  const params = useLocalSearchParams<{ ids?: string | string[] }>();
  const tickedIds = useMemo(() => {
    const raw = params.ids;
    if (!raw) return [];
    return (Array.isArray(raw) ? raw : [raw]).filter(Boolean);
  }, [params.ids]);

  // All wards, so resolution is independent of the list's ward selection.
  const roll = useRoll(null, { eager: true });

  /**
   * Per-voter number drafts, keyed by voter id.
   *
   * A key is ABSENT until the user touches that row's field, and absence
   * means "seed from the voter's own row" — see `draftFor`. Seeding that way
   * (rather than a `useState` fill from `ticked`) is what keeps the fields
   * correct while the eager roll is still paging in: a ticked voter that
   * resolves late still opens with the number it already has, instead of an
   * empty box the user would have to fill with something that is already on
   * file.
   */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  /** One number typed once — see `setShared`. */
  const [shared, setSharedState] = useState('');
  /** The previous shared value, so a row edit survives the next keystroke. */
  const sharedRef = useRef('');
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const uid = user?.uid ?? 'local';

  const byId = useMemo(
    () => new Map(roll.voters.map((voter) => [voter.id, voter])),
    [roll.voters]
  );
  const byEpic = useMemo(() => {
    const map = new Map<string, VoterView>();
    for (const voter of roll.voters) {
      map.set(voter.epicId.trim().toUpperCase(), voter);
    }
    return map;
  }, [roll.voters]);

  const ticked = useMemo(
    () =>
      tickedIds
        .map((id) => byId.get(id))
        .filter((voter): voter is VoterView => Boolean(voter)),
    [tickedIds, byId]
  );

  /** How many rows currently hold a usable number — the save button's count. */
  const readyCount = useMemo(
    () =>
      ticked.filter((voter) => {
        const value =
          drafts[voter.id] !== undefined ? drafts[voter.id] : (voter.effective.phone ?? '');
        return isValidPhone(value.trim());
      }).length,
    [ticked, drafts]
  );

  const lines = useMemo<ParsedLine[]>(() => {
    const seen = new Set<string>();
    const out: ParsedLine[] = [];
    for (const raw of paste.split('\n')) {
      const parsed = parseLine(raw.trim());
      if (!parsed) continue;
      if (seen.has(parsed.epic)) continue; // a repeated EPIC keeps its first line
      seen.add(parsed.epic);
      out.push({ ...parsed, voter: byEpic.get(parsed.epic) ?? null });
    }
    return out;
  }, [paste, byEpic]);

  const unmatched = lines.filter((line) => line.voter === null);
  const matched = lines.filter((line) => line.voter !== null);

  /** The one shared writer: same `patchVoter` path as a single edit. */
  const apply = async (
    kind: string,
    targets: { voter: VoterView; phone: string }[]
  ) => {
    setBusy(kind);
    try {
      let changed = 0;
      for (const target of targets) {
        const value = target.phone.trim();
        // Rows that already hold this number are not writes: `patchVoter`
        // would no-op them, and counting them would make the toast below
        // claim work that never happened. On a screen whose rows arrive
        // PRE-FILLED with what is already on file, that difference is most
        // of the button presses.
        if (value === (target.voter.effective.phone ?? '')) continue;
        await patchVoter(overlayStorage, {
          voterId: target.voter.id,
          wardNo: target.voter.wardNo,
          uid,
          patch: { phone: value },
        });
        changed += 1;
        // Mirror to the team's shared number board, best-effort: the local
        // overlay above is the save; a rejected share just stays private.
        if (isValidPhone(value)) {
          void writeProposal({
            voterId: target.voter.id,
            wardNo: target.voter.wardNo,
            phone: value,
            authorName: profile?.displayName || user?.email || 'Unknown',
            role: profile?.role ?? null,
            myWardNo: profile?.wardNo ?? null,
          }).catch(() => undefined);
        }
      }
      void pushEdits();
      if (changed === 0) {
        toast.info(t('voters.bulkNoChanges'));
      } else {
        toast.success(t('voters.bulkApplied', { count: changed }));
      }
      router.back();
    } catch {
      toast.error(t('common.errorTitle'));
    } finally {
      setBusy(null);
    }
  };

  /** What the row's field shows: the draft, else the number already on file. */
  const draftFor = (voter: VoterView) =>
    drafts[voter.id] !== undefined ? drafts[voter.id] : (voter.effective.phone ?? '');

  const setDraft = (voterId: string, text: string) =>
    setDrafts((previous) => ({ ...previous, [voterId]: text }));

  /**
   * The one field the whole screen is built around: type a number and it
   * lands in every row as you type — no "fill" button to press, no voter id
   * to look up first.
   *
   * Only rows still holding the PREVIOUS shared number (or nothing at all)
   * are overwritten. A row the user retyped by hand therefore keeps its own
   * value: the fill is a starting point, not a lock, and correcting a typo in
   * the shared field must not quietly undo someone's per-row fix.
   */
  const setShared = (text: string) => {
    const previous = sharedRef.current.trim();
    sharedRef.current = text;
    setSharedState(text);

    const value = text.trim();
    if (!value) return; // clearing the field must not wipe what is already in the rows
    setDrafts((old) => {
      const next = { ...old };
      for (const voter of ticked) {
        const current =
          old[voter.id] !== undefined
            ? old[voter.id].trim()
            : (voter.effective.phone ?? '').trim();
        const untouched = old[voter.id] === undefined;
        const carriesPrevious = previous !== '' && current === previous;
        if (untouched || carriesPrevious) next[voter.id] = value;
      }
      return next;
    });
  };

  /**
   * Saves every row that carries a number, leaving empty rows alone.
   *
   * A number that is present but UNUSABLE stops the save instead of being
   * quietly skipped — half a bulk write that reported success is the failure
   * mode this screen exists to avoid, and the names in the toast are what
   * turns "something went wrong" into "row 3, the Sharma one".
   */
  const applyRows = async () => {
    const targets = ticked
      .map((voter) => ({ voter, phone: draftFor(voter).trim() }))
      .filter((target) => target.phone !== '');

    if (targets.length === 0) {
      toast.error(t('voters.bulkBadPhone'));
      return;
    }

    const invalid = targets.filter((target) => !isValidPhone(target.phone));
    if (invalid.length > 0) {
      toast.error(
        t('voters.bulkInvalidRows', {
          names: invalid
            .slice(0, 3)
            .map((target) => target.voter.effective.name)
            .join(', '),
          extra: invalid.length > 3 ? ` (+${invalid.length - 3})` : '',
        })
      );
      return;
    }

    await apply('rows', targets);
  };

  const applyPaste = async () => {
    if (!matched.length) {
      toast.error(t('voters.bulkNoneMatched'));
      return;
    }
    await apply(
      'paste',
      matched.map((line) => ({ voter: line.voter as VoterView, phone: line.phone }))
    );
  };

  // Every section needs loaded rows to resolve against: ticked ids from the
  // list and EPICs from a paste both resolve against the bundled roll, and a
  // half-loaded `eager` batch would read as "0 matched" — a lie about the
  // data rather than about the input.
  const loading = roll.loading || roll.loadingMore || roll.hasMore;

  return (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={styles.body}
      keyboardShouldPersistTaps='handled'
    >
      <Text variant='caption'>{t('voters.bulkIntro')}</Text>

      {loading ? (
        <View style={styles.center}>
          <Spinner variant='circle' />
          <Text variant='caption'>{t('voters.bulkLoading')}</Text>
        </View>
      ) : null}

      {!loading && ticked.length > 0 ? (
        <Card style={styles.card}>
          <Text variant='subtitle'>
            {t('voters.selectedCount', { count: ticked.length })}
          </Text>
          <Text variant='caption'>{t('voters.bulkPerVoter')}</Text>

          {/* One number for everyone — the whole point of this screen. Typed
              once, it fills the rows below as it is typed (see `setShared`),
              which keeps the old single-field bulk entry: no voter id, no
              EPIC, no second press. The rows underneath exist to be checked
              against the faces and to be corrected one by one when a house
              has its own line. */}
          <Input
            label={t('voters.bulkSharedNumber')}
            value={shared}
            onChangeText={setShared}
            keyboardType='phone-pad'
            placeholder={t('voters.phoneHint')}
            variant='outline'
            disabled={busy !== null}
          />
          <Text variant='caption'>{t('voters.bulkSharedHint')}</Text>
          <Button
            loading={busy === 'rows'}
            disabled={busy !== null || readyCount === 0}
            onPress={() => void applyRows()}
          >
            {t('voters.bulkUpdateCount', { count: readyCount })}
          </Button>

          {/* One row per ticked voter — photo, name and their own number
              field — bordered so each voter reads as one object rather than
              three loose lines. "Which voters am I about to change?" is
              answered by faces and names rather than by a count. */}
          <View style={styles.rows}>
            {ticked.map((voter) => (
              <BulkVoterRow
                key={voter.id}
                voter={voter}
                value={draftFor(voter)}
                disabled={busy !== null}
                onChange={(text) => setDraft(voter.id, text)}
              />
            ))}
          </View>

          <Text variant='caption'>
            {t('voters.bulkRowsReady', {
              ready: readyCount,
              total: ticked.length,
            })}
          </Text>
          {/* The same save as above, repeated after the rows on purpose: the
              top one is the end of "type a number, press once", this one is
              the end of "I corrected a row by hand" — neither should have to
              scroll past forty rows to find its own button. */}
          <Button
            loading={busy === 'rows'}
            disabled={busy !== null || readyCount === 0}
            onPress={() => void applyRows()}
          >
            {t('voters.bulkUpdateCount', { count: readyCount })}
          </Button>
        </Card>
      ) : null}

      {!loading && ticked.length === 0 ? (
        <Text variant='caption'>{t('voters.bulkNoSelection')}</Text>
      ) : null}

      {!loading ? (
        <Card style={styles.card}>
          <Text variant='subtitle'>{t('voters.bulkPaste')}</Text>
          <Input
            label={t('voters.bulkPaste')}
            value={paste}
            onChangeText={setPaste}
            type='textarea'
            rows={6}
            placeholder={'ABC1234567, 9876543210\nXYZ7654321 9812345678'}
          />
          <Text variant='caption'>{t('voters.bulkPasteHint')}</Text>
          {paste.trim() ? (
            <Text variant='caption'>
              {t('voters.bulkMatched', {
                matched: matched.length,
                total: lines.length,
              })}
            </Text>
          ) : null}
          {unmatched.length > 0 && unmatched.length <= 10 ? (
            <Text variant='caption'>
              {t('voters.bulkUnmatched', {
                epics: unmatched.map((line) => line.epic).join(', '),
              })}
            </Text>
          ) : null}
          <Button
            loading={busy === 'paste'}
            disabled={busy !== null || matched.length === 0}
            onPress={() => void applyPaste()}
          >
            {t('common.apply')}
          </Button>
        </Card>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: { padding: 20, gap: 14, paddingBottom: 112 },
  center: { alignItems: 'center', gap: 8, paddingVertical: 20 },
  card: { gap: 10 },
  rows: { gap: 8 },
  /**
   * One voter, one box. A full 1pt border rather than the hairline the list
   * cards use: these rows carry an EDITABLE field, and an editable thing that
   * does not look bounded reads as loose text on the card behind it. The
   * background is the card colour, so the box still holds up in dark mode.
   */
  row: {
    flexDirection: 'row',
    gap: 10,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  /** The portrait gets the same treatment at thumbnail scale — a bordered,
   *  rounded square, never a bare image floating beside the name. */
  rowPhoto: {
    width: 46,
    height: 46,
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
  },
  rowPhotoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** `minWidth: 0` lets this column shrink: a long Devanagari name or an
   *  open keyboard would otherwise push the row wider than the screen. */
  rowText: { flex: 1, minWidth: 0, gap: 4 },
});

/**
 * One ticked voter in the bulk list: photo, name, and THEIR number field —
 * the three things that identify "this person, this number", held together
 * in one bordered box so a scrolling list of forty reads as forty voters
 * rather than as eighty loose lines.
 *
 * The face and the name lead because the question this row answers is "which
 * voter is this number going onto?", and a bare name in a scrolling list
 * answers it badly.
 *
 * The photo precedence is the roll list's own (own capture → bundled roll
 * portrait → placeholder), so a face here is the face everywhere else in the
 * app. The placeholder is icon-only: `voters.noPhoto` reads as a verdict at
 * this size, and the row is already identified by the name beside it.
 */
function BulkVoterRow({
  voter,
  value,
  disabled,
  onChange,
}: {
  voter: VoterView;
  value: string;
  disabled?: boolean;
  onChange: (text: string) => void;
}) {
  const { t } = useTranslation();
  const border = useColor('border');
  const card = useColor('card');
  const muted = useColor('muted');
  const outline = useColor('outline');

  const effective = voter.effective;
  const bundledPhoto = rollPhotoAsset(voter);
  const photoSource = voter.photoUrl
    ? ({ uri: voter.photoUrl } as const)
    : bundledPhoto;

  return (
    <View style={[styles.row, { borderColor: border, backgroundColor: card }]}>
      {photoSource ? (
        <Image
          source={photoSource}
          width={46}
          height={46}
          variant='default'
          // Recycled rows flash a spinner otherwise — same call as the card.
          showLoadingIndicator={false}
          showErrorFallback={false}
          containerStyle={[styles.rowPhoto, { borderColor: border }]}
        />
      ) : (
        <View
          style={[
            styles.rowPhoto,
            styles.rowPhotoPlaceholder,
            { backgroundColor: muted, borderColor: border },
          ]}
        >
          <Icon name={UserX} size={16} color={outline} />
        </View>
      )}

      <View style={styles.rowText}>
        {/* `subtitle`, not `body`: the name is what identifies this row, and
            at this size it has to lead the number field under it. */}
        <Text variant='subtitle' numberOfLines={1}>
          {effective.name}
        </Text>
        <Text variant='caption' numberOfLines={1}>
          {t('voters.serial', { no: voter.serialNo })}
          {effective.fatherOrHusbandName
            ? ` · ${effective.fatherOrHusbandName}`
            : ''}
          {effective.houseNo
            ? ` · ${t('voters.house')} ${effective.houseNo}`
            : ''}
        </Text>
        <Input
          value={value}
          onChangeText={onChange}
          keyboardType='phone-pad'
          placeholder={t('common.phone')}
          containerStyle={{ marginTop: 2 }}
          variant='outline'
          disabled={disabled}
        />
      </View>
    </View>
  );
}