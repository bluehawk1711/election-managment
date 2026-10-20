import { Chip, type ChipTone } from '@/components/campaign/chip';
import { Icon } from '@/components/ui/icon';
import { Image } from '@/components/ui/image';
import { Text } from '@/components/ui/text';
import { View } from '@/components/ui/view';
import { useColor } from '@/hooks/useColor';
import { formatDistance } from '@/lib/geo';
import { LEANING_BADGE, SUPPORT_BADGE } from '@/lib/roll/badges';
import { rollPhotoAsset } from '@/lib/roll/photos';
import type { Leaning, VoterView } from '@/lib/roll/types';
import { CONTROL_RADIUS } from '@/theme/globals';
import { typeStyle } from '@/theme/typography';
import { UserX } from 'lucide-react-native';
import { Pressable, StyleSheet, type ViewStyle } from 'react-native';
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
  /**
   * Enter selection on long-press (bulk actions, e.g. bulk phone update).
   *
   * Absent on cards rendered outside the list's selection-capable context,
   * where a long press has nothing to do.
   */
  onLongPress?: () => void;
  /** Whether this row is ticked in multi-select mode — renders the primary
   *  border so the tap target's state is visible without a checkbox column. */
  selected?: boolean;
};

/**
 * Leaning → chip tone, as a warm-to-cool spectrum across the 5-point scale.
 *
 * Deliberately *not* red/green: those two carry the success/destructive
 * meaning that `support` uses (supporter / opponent), and re-using them here
 * would make "left wing" read as "bad". Amber → neutral → sky reads as a
 * temperature scale, which is what a political spectrum is.
 */
function leaningTone(leaning: Leaning): ChipTone {
  switch (leaning) {
    case 'right':
    case 'centerRight':
      return 'warning';
    case 'centerLeft':
    case 'left':
      return 'info';
    default:
      return 'default';
  }
}

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
 * ## Label: value, on one line
 *
 * Each field is a `label: value` pair occupying one line rather than a label
 * over its value occupying two (`House: 44`, `Age: 33`, `Address: मेन रोड`).
 * The stacked pair spent 20pt a field — six fields ran taller than the photo
 * they sat beside — while the label's actual job, telling the reader which
 * number is which, survives the inline form unchanged: the label is still
 * there, still muted, still attached to its own value. House and age are short
 * enough to share a line; address and mobile each have long values and get a
 * line apiece.
 *
 * ## The photo box
 *
 * A voter with no photo gets a labelled placeholder box rather than nothing at
 * all. That is a real distinction for a karykarta — "photographed" and "not yet
 * photographed" are different states of fieldwork — and an absent image block
 * collapsed the card to a different height than a photographed one.
 */
export function VoterCard({ voter, meters, onPress, onLongPress, selected = false }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? i18n.language;
  const card = useColor('card');
  const border = useColor('border');
  const primary = useColor('primary');
  const muted = useColor('muted');
  const outline = useColor('outline');
  // Shadow tint — matched to the foreground ink so the drop shadow carries the
  // surface's own hue rather than a flat grey. Same recipe as `Card` and the
  // floating tab bar, just tighter for a repeated list row.
  const foreground = useColor('foreground');

  const e = voter.effective;

  // Photo precedence: the user's own capture (overlay) first, then the
  // bundled roll portrait (`assets/photos/`, keyed by voter id), then the
  // placeholder — see lib/roll/photos.ts.
  const bundledPhoto = rollPhotoAsset(voter);
  const photoSource = voter.photoUrl
    ? ({ uri: voter.photoUrl } as const)
    : bundledPhoto;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityRole='button'
      // The whole card is one hit target that opens the edit sheet, so the
      // label has to say that as well as who the voter is.
      accessibilityLabel={`${e.name}, ${t('voters.edit')}`}
      accessibilityState={onLongPress ? { selected } : undefined}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: card,
          // Selection is drawn with the primary border rather than a check
          // mark: the card layout is shared with non-selecting contexts and
          // a filled background would fight the chips below it.
          borderColor: selected ? primary : border,
          borderWidth: selected ? 1.5 : StyleSheet.hairlineWidth,
          // Layered lift: a soft ambient drop plus a faint deeper one, so the
          // card reads as sitting *above* the canvas instead of just being
          // outlined. Tinted with the foreground ink (house style), scaled
          // down from `Card` because these repeat every ~90pt down the list.
          shadowColor: foreground,
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.08,
          shadowRadius: 8,
          elevation: 2,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View style={styles.head}>
        {photoSource ? (
          <Image
            source={photoSource}
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
          {/* The father/husband name rides directly under the name — the
              single-most-used way a karykarta identifies someone in the
              field ("whose son/daughter?"). The roll's own relation label
              (`पिता`/`पति`) prefixes it so the line reads the way the
              speaking does; hidden entirely rather than shown as `—` when
              the roll carries nothing (rare, but the CSVs do have blanks).
              `bodyMd`, not `caption`: at 12px this line read as fine print
              under a name it is meant to *serve*, and a karykarta squinting
              at a phone in sunlight is the reader it has. 14px keeps it
              clearly secondary to the 20px name while staying readable, and
              `typeStyle` (rather than a bare `fontSize`) is what carries the
              Devanagari leading through — see `theme/typography.ts`. */}
          {e.fatherOrHusbandName ? (
            <Text
              numberOfLines={1}
              style={[typeStyle('bodyMd', lang), { color: outline }]}
            >
              {voter.relationLabel ? `${voter.relationLabel}: ` : ''}
              {e.fatherOrHusbandName}
            </Text>
          ) : null}
          <Text variant='caption' numberOfLines={1} style={{ color: outline }}>
            {t('voters.serial', { no: voter.serialNo })} · {voter.epicId}
          </Text>
          {/* The voter's intention first — with us / against us is what a
              karykarta scans for — then turnout, sync state and team
              provenance. `active` on the centre-leaning chip: a bare
              `default` tone renders unfilled, which would read as
              *unselected* rather than *neutral*. */}
          {voter.support !== 'unknown' ||
          voter.leaning !== 'unknown' ||
          voter.voted === 'voted' ||
          voter.pending ||
          voter.team ? (
            <View style={styles.chips}>
              {/* Support and leaning badges are English-only on purpose —
                  see lib/roll/badges.ts. */}
              {voter.support === 'supporter' ? (
                <Chip label={SUPPORT_BADGE.supporter} tone='success' />
              ) : null}
              {voter.support === 'opponent' ? (
                <Chip label={SUPPORT_BADGE.opponent} tone='danger' />
              ) : null}
              {voter.leaning !== 'unknown' ? (
                <Chip
                  label={LEANING_BADGE[voter.leaning]}
                  tone={leaningTone(voter.leaning)}
                  active
                />
              ) : null}
              {voter.voted === 'voted' ? (
                <Chip label={t('voters.votedYes')} tone='success' />
              ) : null}
              {voter.pending ? (
                <Chip label={t('voters.pendingSync')} tone='primary' />
              ) : null}
              {/* A teammate's overlay contributed fields this account has not
                  set — the row carries someone else's fieldwork. Named when
                  the roster had a name (the usual case), plain "Team" when it
                  did not; the entry only exists when it actually contributes,
                  so this chip never lies about there being more here. */}
              {voter.team ? (
                <Chip
                  label={
                    voter.team.authorName
                      ? t('voters.teamEditBy', { name: voter.team.authorName })
                      : t('voters.teamEdit')
                  }
                  tone='info'
                />
              ) : null}
            </View>
          ) : null}

          {/* EPIC rides in the caption line above rather than taking a field
              row of its own: it is a fixed-width identifier, so a dedicated
              slot was a whole line spent saying what the caption already said. */}
          {/* Label and value on one line (`House: 44`), not a label over its
              value: the stacked form cost two lines per field, so the six
              fields below took the height of the photo beside them and the
              card grew to fit its furniture. Inlining keeps the label's
              disambiguation — which is the whole point of the grid — for one
              line per row, and lets the short pair (house + age) share a row
              while the long ones (address, mobile) each get their own. */}
          <View style={styles.fields}>
            <View style={styles.pairRow}>
              <InlineField
                label={t('voters.house')}
                value={e.houseNo}
                style={styles.pair}
              />
              <InlineField
                label={t('voters.age')}
                value={String(e.age)}
                style={styles.pair}
              />
            </View>
            <InlineField label={t('voters.locality')} value={e.locality} wrap />
            {e.phone ? (
              <InlineField label={t('common.phone')} value={e.phone} />
            ) : null}
            {meters === undefined ? null : (
              <InlineField
                label={t('voters.distance')}
                value={formatDistance(meters)}
              />
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
 *
 * 80, down from 100: at 100 the 160pt photo was the card's height floor, and
 * a list of 9:16 portraits is a contact sheet, not a roll — the karykarta
 * scrolls past three voters where they should see five. 80×142 keeps a face
 * recognisable (the card taps through to the full photo for the rest) and
 * lets the data column set the card's height instead.
 */
const PHOTO_WIDTH = 80;
const PHOTO_HEIGHT = Math.round((PHOTO_WIDTH * 16) / 9); // 160 — exactly 9:16

/**
 * One `label: value` pair, on a single line.
 *
 * Module-level for the same reason as `DetailRow`: a component declared inside
 * `VoterCard`'s body is a *new type* every render, so React unmounts and
 * remounts the subtree instead of diffing it — which defeats every `memo`
 * beneath it and shows up as flicker in a recycled list.
 *
 * Label first, in the muted caption ink, value after it in body ink: the label
 * is what stops `44` and `33` from being two anonymous numbers (the reason the
 * card is a grid rather than a run-on line), and it does not need to be as
 * loud as the value it names.
 */
function InlineField({
  label,
  value,
  wrap,
  style,
}: {
  label: string;
  value: string;
  /** Let a long value take a second line — the address, and only the address. */
  wrap?: boolean;
  style?: ViewStyle;
}) {
  const outline = useColor('outline');

  return (
    <View style={[styles.inlineField, style]}>
      <Text variant='caption' style={{ color: outline }}>
        {label}:
      </Text>
      {/* `—` for an empty value: the slot stays put, so a voter missing a
          locality has the same shape as one that has it. */}
      <Text numberOfLines={wrap ? 2 : 1} style={styles.inlineValue}>
        {value || '—'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    // 10 vertical / 12 horizontal: the card used to run 14/14, which at the
    // new photo size spent more vertical budget on border clearance than on
    // rows of data. The tighter inset is what actually shrinks the card — the
    // photo box alone only moved the floor.
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: CONTROL_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
  },
  // `flex-start`, not `center`: the right column is taller than the photo, and
  // centring would float the photo in the middle of it and leave an awkward gap
  // under the image — the thing that made the first version look unbalanced.
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  headText: { flex: 1, gap: 3, minWidth: 0 },
  // 8, the same rail every chip row in the app uses (FilterBar, the edit
  // screen's intent row and segments) — 6 made this row visibly tighter
  // than the ones beside it in the flow.
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
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
  // Stacked rows of one-line fields: `fields` is the column, `pairRow` is the
  // house + age line that shares its width, and the address/phone lines below
  // it run full width because each has a long value to spend it on.
  fields: { gap: 6, marginTop: 1 },
  pairRow: { flexDirection: 'row', gap: 12 },
  // `minWidth: 0` beside the flex: without it neither half of the pair can
  // shrink below its content, and a long house number pushes age off the line.
  pair: { flex: 1, minWidth: 0 },
  inlineField: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  // The value takes the room the label leaves, so a long locality wraps inside
  // its own box instead of widening the row past the card's edge.
  inlineValue: { flex: 1, minWidth: 0 },
});
