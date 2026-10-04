import { Chip } from '@/components/campaign/chip';
import { Icon } from '@/components/ui/icon';
import { Image } from '@/components/ui/image';
import { Text } from '@/components/ui/text';
import { View } from '@/components/ui/view';
import { useColor } from '@/hooks/useColor';
import { formatDistance } from '@/lib/geo';
import type { VoterView } from '@/lib/roll/types';
import { CONTROL_RADIUS } from '@/theme/globals';
import { UserX } from 'lucide-react-native';
import { Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

type Props = {
  voter: VoterView;
  /**
   * Metres from the user, present only while nearest-voter mode is on.
   *
   * Absent rather than `null` so "no fix captured" (filtered out of the list
   * entirely) and "not ranking right now" cannot be confused — see the
   * `located` map in `app/(tabs)/voters/index.tsx`.
   */
  meters?: number;
  onPress: () => void;
};

/**
 * One voter in the roll list: photo on the left, labelled data on the right.
 *
 * ## Why this replaced `ListRow`
 *
 * `ListRow` takes a `title`, a `subtitle` and a `meta`, and this screen was
 * concatenating `houseNo`, `locality`, the distance and `epicId` into that one
 * subtitle with `·` separators. The result read as a dumped string: "44 · मेन
 * रोड · w1-42" gives no way to tell which number was the house and which was
 * the EPIC, and a missing value silently collapsed the row so a voter with no
 * locality had a *shorter* card than one with a full address.
 *
 * Every field now carries its own label and occupies a fixed slot, so the card
 * is a grid rather than a sentence, and "no data" is an explicit `—` in a place
 * the eye already expects instead of a gap in a run-on line.
 *
 * ## One row, not a header above a body
 *
 * Everything sits in a single row: the photo on the left, all of the data in
 * the column to its right. The first version put the name and chips in a header
 * row and ran the labelled fields full width *underneath* it, which made every
 * card about a third taller than it needed to be and left the left third of the
 * lower half empty — the eye read a tall block with a hole in it. Folding the
 * fields into the right column costs nothing in legibility (the labels do that
 * work, not the whitespace) and cuts the card back to roughly the height of its
 * own text: the photo no longer adds a row of its own underneath.
 *
 * ## The photo box
 *
 * A voter with no photo gets a labelled placeholder box rather than nothing at
 * all. That is a real distinction for a karykarta — "photographed" and "not yet
 * photographed" are different states of fieldwork — and an absent image block
 * collapsed the card to a different height than a photographed one.
 */
export function VoterCard({ voter, meters, onPress }: Props) {
  const { t } = useTranslation();
  const card = useColor('card');
  const border = useColor('border');
  const muted = useColor('muted');
  const outline = useColor('outline');

  const e = voter.effective;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole='button'
      // The whole card is one hit target that opens the edit sheet, so the
      // label has to say that as well as who the voter is.
      accessibilityLabel={`${e.name}, ${t('voters.edit')}`}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: card,
          borderColor: border,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View style={styles.head}>
        {voter.photoUrl ? (
          <Image
            source={{ uri: voter.photoUrl }}
            width={PHOTO_WIDTH}
            height={PHOTO_HEIGHT}
            variant='default'
            // The card is recycled by `FlashList`, so the built-in loading
            // spinner flashes on every scroll-back. A thumbnail this size reads
            // as loaded or not loaded well enough without it.
            showLoadingIndicator={false}
            // Its fallback is the word "Failed to load image", which is both
            // wrong (a local file that was deleted is not a failed *load* in
            // any useful sense) and too long for the box.
            showErrorFallback={false}
            containerStyle={styles.photoBox}
          />
        ) : (
          <View
            style={[
              styles.photoBox,
              styles.photoPlaceholder,
              { backgroundColor: muted, borderColor: border },
            ]}
          >
            <Icon name={UserX} size={18} color={outline} />
            <Text variant='caption' style={[styles.placeholderText, { color: outline }]}>
              {t('voters.noPhoto')}
            </Text>
          </View>
        )}

        {/* `minWidth: 0` is what lets this column actually shrink: without it a
            long Devanagari name or locality sets the column's floor at its
            content width and pushes the row wider than the screen. */}
        <View style={styles.headText}>
          {/* `title`, not `heading`: at 24px the name was the loudest thing on
              the card and set the row's rhythm by itself, while the portrait
              photo beside it already carries the eye. `title` (20px) keeps the
              name the first thing read without it out-shouting its own data. */}
          <Text variant='title' numberOfLines={1}>
            {e.name}
          </Text>
          <Text variant='caption' numberOfLines={1} style={{ color: outline }}>
            {t('voters.serial', { no: voter.serialNo })} · {voter.epicId}
          </Text>
          {/* Conditional rather than an always-rendered empty row: `headText`
              is a `gap: 4` column, so an empty child still costs a gap, and
              most voters are neither voted nor pending. */}
          {voter.voted === 'voted' || voter.pending ? (
            <View style={styles.chips}>
              {voter.voted === 'voted' ? (
                <Chip label={t('voters.votedYes')} tone='success' />
              ) : null}
              {voter.pending ? (
                <Chip label={t('voters.pendingSync')} tone='primary' />
              ) : null}
            </View>
          ) : null}

          {/* EPIC rides in the caption line above rather than taking a grid row
              of its own: it is a fixed-width identifier, so a dedicated slot
              was a whole line spent saying what the caption already said. */}
          <View style={styles.fields}>
            <Field label={t('voters.house')} value={e.houseNo} />
            <Field label={t('voters.age')} value={String(e.age)} />
            <Field label={t('voters.locality')} value={e.locality} wide />
            {e.phone ? <Field label={t('common.phone')} value={e.phone} /> : null}
            {meters === undefined ? null : (
              <Field label={t('voters.distance')} value={formatDistance(meters)} />
            )}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

/**
 * Photo box width, and the floor for the card's height.
 *
 * The height is *derived*, not set: the box is portrait 9:16 so a full-length
 * voter photo fits without the crop `contentFit='cover'` would otherwise take
 * off the head and feet. Writing both numbers by hand is how a box quietly
 * drifts off-ratio the next time someone bumps one side.
 */
const PHOTO_WIDTH = 90;
const PHOTO_HEIGHT = Math.round((PHOTO_WIDTH * 16) / 9); // 160 — exactly 9:16

/**
 * One label/value pair.
 *
 * Module-level for the same reason as `DetailRow`: a component declared inside
 * `VoterCard`'s body is a *new type* every render, so React unmounts and
 * remounts the subtree instead of diffing it — which defeats every `memo`
 * beneath it and shows up as flicker in a recycled list.
 */
function Field({
  label,
  value,
  wide,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  const outline = useColor('outline');

  return (
    <View style={[styles.field, wide ? styles.fieldWide : null]}>
      <Text variant='caption' style={{ color: outline }}>
        {label}
      </Text>
      {/* `—` for an empty value: the slot stays put, so a voter missing a
          locality has the same shape as one that has it. */}
      <Text numberOfLines={2}>{value || '—'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 14,
    borderRadius: CONTROL_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
  },
  // `flex-start`, not `center`: the right column is taller than the photo, and
  // centring would float the photo in the middle of it and leave an awkward gap
  // under the image — the thing that made the first version look unbalanced.
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  headText: { flex: 1, gap: 4, minWidth: 0 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  photoBox: {
    width: PHOTO_WIDTH,
    height: PHOTO_HEIGHT,
    borderRadius: CONTROL_RADIUS,
    overflow: 'hidden',
  },
  photoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  placeholderText: { fontSize: 10 },
  fields: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 2 },
  // `flexGrow` on the halves so a lone field (phone recorded, nearest mode off)
  // still fills its row instead of hugging the left edge.
  field: { flexGrow: 1, flexBasis: '45%', gap: 2 },
  fieldWide: { flexBasis: '100%' },
});
