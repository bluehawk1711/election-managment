/**
 * Bulk phone update (user demand #8, all three entry styles):
 *
 *   1. **Tick rows** — long-press in the list, tap “Bulk phone”; the ticked
 *      ids arrive here as the `ids` param and pre-fill the first section.
 *   2. **Whole house** — the button on the edit sheet next to the phone field
 *      (`applyToHouse` there), which needs no screen and applies to exactly
 *      what is typed. This screen is its sibling, not its duplicate.
 *   3. **Paste an EPIC list** — `EPIC, phone` per line, the shape a volunteer
 *      is handed from a sheet. Digits and separators are normalised loosely
 *      (comma / tab / colon / semicolon / space all split), because the list
 *      is always typed or pasted from somewhere else and strict parsing would
 *      make half of it fail silently.
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
import { Input } from '@/components/ui/input';
import { ScrollView } from '@/components/ui/scroll-view';
import { Spinner } from '@/components/ui/spinner';
import { Text } from '@/components/ui/text';
import { useToast } from '@/components/ui/toast';
import { View } from '@/components/ui/view';
import { useRoll } from '@/hooks/useRoll';
import { e164 } from '@/lib/contact';
import { overlayStorage, patchVoter } from '@/lib/roll/overlay';
import { isValidPhone } from '@/lib/roll/contacts';
import { writeProposal } from '@/lib/roll/contacts-store';
import { pushEdits } from '@/lib/roll/sync';
import type { VoterView } from '@/lib/roll/types';
import { useAuth } from '@/providers/auth-provider';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
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

  const [phone, setPhone] = useState('');
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
        await patchVoter(overlayStorage, {
          voterId: target.voter.id,
          wardNo: target.voter.wardNo,
          uid,
          patch: { phone: target.phone.trim() },
        });
        changed += 1;
        // Mirror to the team's shared number board, best-effort: the local
        // overlay above is the save; a rejected share just stays private.
        if (isValidPhone(target.phone)) {
          void writeProposal({
            voterId: target.voter.id,
            wardNo: target.voter.wardNo,
            phone: target.phone,
            authorName: profile?.displayName || user?.email || 'Unknown',
            role: profile?.role ?? null,
            myWardNo: profile?.wardNo ?? null,
          }).catch(() => undefined);
        }
      }
      void pushEdits();
      toast.success(t('voters.bulkApplied', { count: changed }));
      router.back();
    } catch {
      toast.error(t('common.errorTitle'));
    } finally {
      setBusy(null);
    }
  };

  const applyTicked = async () => {
    const number = e164(phone);
    if (!number || number.replace(/\D/g, '').length < 10) {
      toast.error(t('voters.bulkBadPhone'));
      return;
    }
    // Stored as typed (trimmed), exactly like a single edit in the sheet —
    // `e164` is the VALIDATOR here, not the formatter; bulk rows must not end
    // up in `+91…` shape while sheet-saved rows stay `98765…`-shaped.
    await apply('ticked', ticked.map((voter) => ({ voter, phone: phone.trim() })));
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
          {/* First few names, so “these 47?” is verifiable before commit —
              the count alone is not, and a bulk write is the one action here
              that is annoying to reverse. */}
          <View style={styles.preview}>
            {ticked.slice(0, 8).map((voter) => (
              <Text key={voter.id} variant='caption' numberOfLines={1}>
                {voter.effective.name}
              </Text>
            ))}
            {ticked.length > 8 ? (
              <Text variant='caption'>…</Text>
            ) : null}
          </View>
          <Input
            label={t('common.phone')}
            value={phone}
            onChangeText={setPhone}
            keyboardType='phone-pad'
            placeholder={t('voters.phoneHint')}
          />
          <Button
            loading={busy === 'ticked'}
            disabled={busy !== null || !phone.trim()}
            onPress={() => void applyTicked()}
          >
            {t('common.apply')}
          </Button>
        </Card>
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

      {!loading && ticked.length === 0 ? (
        <Text variant='caption'>{t('voters.bulkNoSelection')}</Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: { padding: 20, gap: 14, paddingBottom: 112 },
  center: { alignItems: 'center', gap: 8, paddingVertical: 20 },
  card: { gap: 10 },
  preview: { gap: 2 },
});