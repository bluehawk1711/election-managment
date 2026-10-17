import { DetailRow } from '@/components/roll/detail-row';
import { ContactActions } from '@/components/roll/contact-actions';
import { Chip, type ChipTone } from '@/components/campaign/chip';
import { Badge } from '@/components/ui/badge';
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
import { useVoterContacts } from '@/hooks/useVoterContacts';
import {
  compressForUpload,
  isCloudinaryConfigured,
  savePhotoLocally,
  uploadPhoto,
} from '@/lib/cloudinary';
import { openMaps } from '@/lib/contact';
import { formatDateTime, formatDurationLong } from '@/lib/format';
import { isValidPhone, type PhoneGroup } from '@/lib/roll/contacts';
import { writeProposal } from '@/lib/roll/contacts-store';
import { LEANING_BADGE, SUPPORT_BADGE } from '@/lib/roll/badges';
import {
  loadQueue,
  overlayStorage,
  patchVoter,
  putOverlay,
} from '@/lib/roll/overlay';
import { rollPhotoAsset } from '@/lib/roll/photos';
import { pushEdits } from '@/lib/roll/sync';
import type {
  Gender,
  Leaning,
  SupportCategory,
  VotedStatus,
  VoterLocation,
  VoterOverlay,
  VoterView,
} from '@/lib/roll/types';
import { CONTROL_RADIUS, CORNERS } from '@/theme/globals';
import { withOpacity } from '@/theme/colors';
import { useAuth } from '@/providers/auth-provider';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  CheckCircle2,
  Circle,
  Crosshair,
  MapPin,
  UserX,
  XCircle,
} from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Image as RNImage, Modal, Pressable, StyleSheet } from 'react-native';

const GENDERS: Gender[] = ['male', 'female', 'other'];
const SUPPORTS: SupportCategory[] = ['unknown', 'supporter', 'opponent'];

/** The leaning options, in the order plan-voters.md §2 fixes them. */
const LEANING: Leaning[] = ['unknown', 'right', 'centerRight', 'center', 'centerLeft', 'left'];

// Support and leaning BADGES are English-only — `lib/roll/badges.ts` holds
// the labels (and the reason) so the list card and this screen cannot drift.

/**
 * Intent colours for the fieldwork segments — the core of this screen.
 *
 * Each option wears the colour *of what choosing it means*, so the saved
 * state is readable at a glance and the choice itself teaches the scale:
 *
 * - Voted → success green; Not voted → destructive red; Not marked → quiet.
 * - Supporter → green; Opponent → red; Not recorded → quiet. This is the
 *   "with us / against us" dial, and it should feel like one.
 * - Leaning → the warm-to-cool spectrum (amber → neutral → sky) so the
 *   5-point scale reads left-to-right as a temperature gradient. Red and
 *   green are kept out of it on purpose: they mean good/bad in the two
 *   segments above, and a "left wing" chip wearing destructive red would be
 *   an editorial statement the roll does not make.
 *
 * The maps hold *token keys*, resolved through `useColor` in the component,
 * so dark mode follows automatically.
 */
const VOTED_TONE: Record<VotedStatus, ChipTone> = {
  voted: 'success',
  notVoted: 'danger',
  unknown: 'default',
};

const SUPPORT_TONE: Record<SupportCategory, ChipTone> = {
  supporter: 'success',
  opponent: 'danger',
  unknown: 'default',
};

function leaningSegmentTone(value: Leaning): ChipTone {
  switch (value) {
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
 * Background / foreground for one segment button, by tone — resolved from
 * the palette the component already holds, so dark mode follows for free.
 *
 * Filled when the tone is coloured (that is what makes the selection read);
 * the `default` tone stays a tinted-quiet pill in both states, because
 * "Not marked" / "Not recorded" is a real choice, not a disabled control —
 * the old hairline-and-muted-text style read as disabled.
 */
function segmentColors(
  tone: ChipTone,
  active: boolean,
  palette: Record<ChipTone, { bg: string; fg: string }>
): { backgroundColor: string; borderColor: string; color: string } {
  const { bg, fg } = palette[tone];
  if (active) {
    return { backgroundColor: bg, borderColor: bg, color: fg };
  }
  if (tone === 'default') {
    return {
      backgroundColor: withOpacity(bg, 0.5),
      borderColor: 'transparent',
      color: fg,
    };
  }
  // Quiet rest state for a coloured tone: its fill at 15% over the card
  // with a hairline of the same fill — a tinted ghost of the selected
  // state rather than an empty outline.
  return {
    backgroundColor: withOpacity(bg, 0.15),
    borderColor: withOpacity(bg, 0.45),
    color: fg,
  };
}

/** Photo box edge length in the identity header. */
const PHOTO_SIZE = 72;

/**
 * Reads a one-off GPS fix and returns it in `VoterLocation` shape.
 *
 * Module-level on purpose: the React Compiler treats any function declared in
 * the component body as part of render, so calling `Date.now()` in there is a
 * purity violation (`react-hooks/purity`) even though it only ever runs from an
 * on-press. Keeping the impure work out here keeps the component pure.
 *
 * Returns `null` when permission is denied; throws when the fix cannot be read.
 */
async function captureCurrentLocation(): Promise<VoterLocation | null> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== 'granted') return null;

  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  return {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracy: position.coords.accuracy ?? null,
    updatedAt: Date.now(),
  };
}

/**
 * Voter edit sheet (plan-voters.md §6.2–6.3).
 *
 * One screen does everything the app does to a single voter: correct the roll
 * fields, attach a photo, capture a location, mark whether they have voted,
 * record their leaning and support, and call/message them. It absorbed the
 * read-only detail screen, which sat between the list and this form and made
 * every edit two taps and a push/pop away.
 *
 * Writes go to the **overlay** only — the "base roll is read-only" rule.
 * Nothing here calls Firestore, so the save works offline by construction and
 * the queued entry is what a later sync will push.
 *
 * ## Two kinds of write on one screen
 *
 * The text fields are *staged*: they seed `useState`, and one Save button
 * writes them together, so a half-typed name never lands on the roll. The
 * fieldwork controls — photo, location, voted, leaning — *commit immediately*,
 * because each is a single deliberate tap that is already unambiguous, and
 * because a photo picker or a GPS fix cannot be "drafted" in a text field.
 * `dirty` therefore tracks only the staged fields; tapping Voted does not
 * enable Save, and that is correct rather than a missed update.
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
 *
 * The `key` deliberately does **not** include anything that changes when a
 * fieldwork control commits. Those call `roll.refresh()`, which hands down a new
 * `voter` object; if that remounted the form, every keystroke in progress would
 * be thrown away by tapping a chip.
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
  // in the list we came from.
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
          <Spinner size='lg' variant='circle' />
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
      rows={roll.voters}
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
  rows,
}: {
  voter: VoterView;
  wardNo: number;
  onSaved: () => void;
  /** The ward's loaded rows — whatever search scope the list screen had,
   *  used only to count house-mates for the whole-house phone action. */
  rows: VoterView[];
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const { user, profile } = useAuth();
  const outline = useColor('outline');
  const muted = useColor('muted');
  const border = useColor('border');
  // Tone palette for the fieldwork segments — one `useColor` per key,
  // fixed count, picked from a module-level map. See `segmentColors`.
  const toneBg = {
    default: useColor('secondary'),
    primary: useColor('primary'),
    danger: useColor('error'),
    success: useColor('success'),
    warning: useColor('warning'),
    info: useColor('info'),
  } as const;
  const toneFg = {
    default: useColor('secondaryForeground'),
    primary: useColor('primaryForeground'),
    danger: useColor('errorForeground'),
    success: useColor('successForeground'),
    warning: useColor('warningForeground'),
    info: useColor('infoForeground'),
  } as const;
  const tonePalette = {
    default: { bg: toneBg.default, fg: toneFg.default },
    primary: { bg: toneBg.primary, fg: toneFg.primary },
    danger: { bg: toneBg.danger, fg: toneFg.danger },
    success: { bg: toneBg.success, fg: toneFg.success },
    warning: { bg: toneBg.warning, fg: toneFg.warning },
    info: { bg: toneBg.info, fg: toneFg.info },
  };

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
  // No staged `support` state: the segment below writes through `saveNow`
  // like voted/leaning, so it always renders `voter.support`. Staging it as
  // well would let a stale draft overwrite the committed tap on the next
  // Save — two sources of truth for one field.
  const [note, setNote] = useState(voter.overlay.note ?? '');
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);

  /**
   * Which fieldwork control is mid-flight, e.g. `'photo'`.
   *
   * One string rather than a boolean per control so the buttons can all
   * disable each other: capturing a location and picking a photo at the same
   * time would interleave two writes to the same overlay.
   */
  const [busy, setBusy] = useState<string | null>(null);

  const uid = user?.uid ?? 'local';

  /** Shared phone numbers — proposals from the whole team + the final choice. */
  const contacts = useVoterContacts(voter.id, wardNo);
  /** Render clock for the "Added by …" age lines; `Date.now()` in render is a purity violation. */
  const [now] = useState(() => Date.now());
  /** Attribution written onto every proposal this screen shares. */
  const authorName = profile?.displayName || user?.email || 'Unknown';

  const parsedAge = Number(age.trim());
  const ageValid =
    age.trim() !== '' &&
    Number.isInteger(parsedAge) &&
    parsedAge >= 18 &&
    parsedAge <= 100;

  /**
   * Whether any *staged* field has actually changed.
   *
   * `base` is the resolved voter, not an optional lookup, so this cannot be
   * permanently `false` while the row loads — the version that compared
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
    (voter.overlay.note ?? '') !== note;

  /**
   * Writes one immediate field and refreshes the merged view.
   *
   * Separate from the Save button on purpose — see "Two kinds of write" above.
   */
  const saveNow = async (overlay: Partial<VoterOverlay>, label: string) => {
    setBusy(label);
    try {
      await putOverlay(overlayStorage, { voterId: voter.id, wardNo, overlay, uid });
      onSaved();
      // Mirror to the account right away — a fieldwork tap (voted/leaning/
      // photo/location) is a deliberate act worth surviving a lost phone.
      void pushEdits();
    } catch {
      toast.error(t('common.errorTitle'));
    } finally {
      setBusy(null);
    }
  };

  /**
   * Pending-sync queue depth, for the line above Save.
   *
   * Depends on the `pending` boolean rather than the `voter` object: the object
   * is new on every render of the list, and depending on it both re-runs this
   * on every pass and defeats the React Compiler's memoisation.
   */
  /**
   * How many OTHER voters live at this same house, in this ward — everything
   * but the person on screen. Household phone numbers are the common case in
   * the field (one landline per family), so entering the number once on any
   * member can stamp the whole house rather than being typed N times.
   *
   * Matched on `effective.houseNo`, not the base row: a corrected house
   * number on another member still counts as the same house.
   */
  const houseMates = useMemo(() => {
    const house = houseNo.trim();
    if (!house) return [];
    return rows.filter(
      (row) =>
        row.wardNo === voter.wardNo &&
        row.id !== voter.id &&
        row.effective.houseNo.trim() === house
    );
    // `houseNo` is the staged value — the button applies exactly what is
    // typed in the phone field together with what is shown in the house one.
  }, [rows, voter.wardNo, voter.id, houseNo]);

  /** Writes the staged phone number to this row and every house-mate row. */
  const applyToHouse = async () => {
    const value = phone.trim();
    if (!value) return;
    setBusy('house');
    try {
      for (const mate of houseMates) {
        await patchVoter(overlayStorage, {
          voterId: mate.id,
          wardNo: mate.wardNo,
          uid,
          patch: { phone: value },
        });
      }
      await patchVoter(overlayStorage, {
        voterId: voter.id,
        wardNo,
        uid,
        patch: { phone: value },
      });
      // Share every number written above — one proposal per mate, keyed by
      // this account server-side — after the local save has already landed.
      if (isValidPhone(value)) {
        for (const mate of houseMates) {
          void writeProposal({
            voterId: mate.id,
            wardNo: mate.wardNo,
            phone: value,
            authorName,
            role: profile?.role ?? null,
            myWardNo: profile?.wardNo ?? null,
          }).catch(() => undefined);
        }
        void contacts.propose(value, wardNo).catch(() => undefined);
      }
      void pushEdits();
      onSaved();
      toast.success(t('voters.bulkApplied', { count: houseMates.length + 1 }));
    } catch {
      toast.error(t('common.errorTitle'));
    } finally {
      setBusy(null);
    }
  };

  const pending = voter.pending;
  const [queueSize, setQueueSize] = useState(0);
  useEffect(() => {
    let cancelled = false;
    loadQueue(overlayStorage)
      .then((queue) => !cancelled && setQueueSize(queue.length))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [pending]);

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
        uid,
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
          ...((voter.overlay.note ?? '') !== note ? { note } : {}),
        },
      });
      void pushEdits();
      // Mirror the number to the team's shared layer, best-effort: the local
      // overlay write above IS the save, and a rejected share reports rather
      // than rolls back. Shapes `firestore.rules` would refuse are never
      // attempted, and unchanged digits are skipped inside `propose`.
      if (isValidPhone(phone)) {
        void contacts
          .propose(phone, wardNo)
          .then((shared) => {
            if (!shared) toast.error(t('common.errorTitle'));
          })
          .catch(() => toast.error(t('common.errorTitle')));
      }
      onSaved();
      toast.success(t('voters.savedLocally'));
      router.back();
    } catch {
      toast.error(t('common.errorTitle'));
    } finally {
      setSaving(false);
    }
  };

  /**
   * Picks a photo, then either uploads it or keeps it on the device.
   *
   * The local fallback matters: `uploadPhoto` throws by contract when the
   * Cloudinary env vars are missing, so a build without them used to discard
   * the pick entirely and leave an empty frame plus an error toast. Saving the
   * compressed file locally is strictly better than losing it — it shows
   * immediately, and a later sync can upload it.
   */
  const pickPhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t('voters.photoPermission'));
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsEditing: true,
      aspect: [1, 1],
    });
    const asset = picked.assets?.[0];
    if (picked.canceled || !asset) return;

    setBusy('photo');
    try {
      const compressed = await compressForUpload(asset.uri);

      if (isCloudinaryConfigured()) {
        const uploaded = await uploadPhoto(compressed.base64);
        await putOverlay(overlayStorage, {
          voterId: voter.id,
          wardNo,
          overlay: { photoUrl: uploaded.secureUrl, photoPublicId: uploaded.publicId },
          uid,
        });
        void pushEdits();
        onSaved();
      } else {
        const localUri = await savePhotoLocally(compressed.base64, voter.id);
        // No `photoPublicId`: that field means "this lives on Cloudinary", and
        // a later sync reads its absence as "still needs uploading".
        await putOverlay(overlayStorage, {
          voterId: voter.id,
          wardNo,
          overlay: { photoUrl: localUri },
          uid,
        });
        void pushEdits();
        onSaved();
        toast.success(t('voters.photoSavedLocally'));
      }
    } catch (caught) {
      toast.error(
        t('voters.photoFailed'),
        caught instanceof Error ? caught.message : undefined
      );
    } finally {
      setBusy(null);
    }
  };

  const captureLocation = async () => {
    setBusy('location');
    try {
      const location = await captureCurrentLocation();
      if (!location) {
        Alert.alert(t('voters.locationFailed'));
        return;
      }
      await putOverlay(overlayStorage, {
        voterId: voter.id,
        wardNo,          overlay: { location },
          uid,
        });
        void pushEdits();
        onSaved();
    } catch {
      toast.error(t('voters.locationFailed'));
    } finally {
      setBusy(null);
    }
  };

  /** Super admin: put this team-proposed number in use for everyone.
   *
   * Named `chooseNumber`, not `useNumber`: a component-scope function whose
   * name starts with `use` is treated as a React Hook, and calling it from an
   * onPress callback is a rules-of-hooks error — which lint caught on the
   * first pass.
   */
  const chooseNumber = async (group: PhoneGroup) => {
    try {
      await contacts.finalize(group, wardNo);
      toast.success(t('common.savedToast'));
    } catch {
      toast.error(t('common.errorTitle'));
    }
  };

  /** Super admin: take the current number back out of use. */
  const stopUsing = async () => {
    try {
      await contacts.clearFinalize(wardNo);
      toast.success(t('common.savedToast'));
    } catch {
      toast.error(t('common.errorTitle'));
    }
  };

  /**
   * Full-screen viewer for the photo box.
   *
   * Tapping an EXISTING photo opens THIS, never the system picker — looking
   * at someone's picture must not raise a permission sheet. The picker lives
   * on the caption below (add/replace), which is where "I want to change
   * it" belongs.
   */
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const showMaps = async () => {
    const location = voter.location;
    if (!location) return;
    const ok = await openMaps(location.lat, location.lng);
    if (!ok) toast.error(t('voters.openMapsFailed'));
  };

  /**
   * What the photo box shows — computed ONCE per render and shared by the
   * tap handler (lightbox vs picker) and the render below, replacing an
   * inline IIFE whose whole job was the same look-up.
   *
   * Precedence, same as the list card: the user's own capture first, then
   * the bundled roll portrait (`assets/photos/`, keyed by voter id), then
   * nothing.
   */
  const photoSource = voter.photoUrl
    ? ({ uri: voter.photoUrl } as const)
    : rollPhotoAsset(voter);

  return (
    // The bounded `View` is load-bearing, not decoration on the ScrollView.
    // As the bare root of a screen the ScrollView relied on the scene
    // stretching it to a bounded height, which it does not do reliably on
    // Android — so it laid out at its full content height and never became
    // scrollable. Every scrolling screen in this app wraps one.
    <View style={styles.fill}>
      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps='handled'
      >
        <Text variant='caption'>{t('voters.editHint')}</Text>

        {/* Identity + photo. The box doubles as the add/replace control, which
            is why there is no separate "Add photo" button repeating it. */}
        <View style={styles.identity}>
          <Pressable
            onPress={() => {
              // Tap an EXISTING photo → view it full-screen (lightbox
              // below). The picker is deliberately NOT on this tap: looking
              // at someone's picture must never raise a permission sheet.
              // Only the empty frame (no photo at all) opens the picker,
              // since there is nothing to view yet.
              if (photoSource) setLightboxOpen(true);
              else void pickPhoto();
            }}
            accessibilityRole='button'
            accessibilityLabel={
              photoSource ? t('voters.photo') : t('voters.addPhoto')
            }
            style={[
              styles.photoBox,
              { backgroundColor: muted, borderColor: border },
            ]}
          >
            {photoSource ? (
              <Image
                source={photoSource}
                width={PHOTO_SIZE}
                height={PHOTO_SIZE}
                variant='default'
                showLoadingIndicator={false}
                containerStyle={styles.photoFill}
              />
            ) : (
              <>
                <Icon name={UserX} size={20} color={outline} />
                <Text
                  variant='caption'
                  style={[styles.placeholderText, { color: outline }]}
                >
                  {t('voters.noPhoto')}
                </Text>
              </>
            )}
            {busy === 'photo' ? (
              <View style={styles.photoBusy}>
                <Spinner size='sm' variant='circle' />
              </View>
            ) : null}
          </Pressable>

          <View style={styles.identityText}>
            <Text variant='heading' numberOfLines={2}>
              {base.name}
            </Text>
            <Text variant='caption' style={{ color: outline }}>
              {t('voters.serial', { no: voter.serialNo })} · {voter.epicId}
            </Text>
            {/* Intent at a glance, right under the name: which side, which
                leaning, whether they voted — the three facts this whole
                screen exists to record, summarised before the form asks
                for anything. Rendered only when at least one is recorded,
                so the untouched state stays as quiet as it was. */}
            {voter.support !== 'unknown' ||
            voter.leaning !== 'unknown' ||
            voter.voted !== 'unknown' ? (
              <View style={styles.intentRow}>
                {voter.support !== 'unknown' ? (
                  <Chip
                    label={SUPPORT_BADGE[voter.support]}
                    tone={SUPPORT_TONE[voter.support]}
                  />
                ) : null}
                {voter.leaning !== 'unknown' ? (
                  <Chip
                    label={LEANING_BADGE[voter.leaning]}
                    tone={leaningSegmentTone(voter.leaning)}
                    active
                  />
                ) : null}
                {voter.voted !== 'unknown' ? (
                  <Chip
                    label={t(
                      voter.voted === 'voted'
                        ? 'voters.votedYes'
                        : 'voters.votedNo'
                    )}
                    tone={VOTED_TONE[voter.voted]}
                  />
                ) : null}
              </View>
            ) : null}
            {/* Where the PICKER now lives: tapping the photo views it, so
                changing it needs its own control — and this caption already
                said exactly the right words, it just was not tappable. */}
            <Pressable
              onPress={() => void pickPhoto()}
              hitSlop={8}
              accessibilityRole='button'
              accessibilityLabel={
                photoSource ? t('voters.replacePhoto') : t('voters.addPhoto')
              }
            >
              <Text variant='caption' style={{ color: outline }}>
                {busy === 'photo'
                  ? t('voters.photoUploading')
                  : photoSource
                    ? t('voters.replacePhoto')
                    : t('voters.addPhoto')}
              </Text>
            </Pressable>
            {voter.pending ? (
              <Text variant='caption' style={{ color: outline }}>
                {t('voters.pendingSync')}
              </Text>
            ) : null}
          </View>
        </View>

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
                {t(`voters.genderOption.${value}` as const)}
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

        {/* One number, whole house. Rendered only when the house actually has
            other members in the loaded roll — a button offering to update
            zero people is noise — and only from an enabled input, since an
            empty phone has nothing to apply. */}
        {houseMates.length > 0 ? (
          <Button
            size='sm'
            variant='outline'
            loading={busy === 'house'}
            disabled={busy !== null || !phone.trim()}
            onPress={() => void applyToHouse()}
          >
            {t('voters.applyToHouse', { count: houseMates.length + 1 })}
          </Button>
        ) : null}

        {/* Themed trio — each service keeps its own identity (dial green,
            WhatsApp brand green, SMS blue). It dials whatever is typed above,
            falling back to the super admin's chosen number so an untouched
            voter still has working buttons. */}
        <ContactActions
          phone={phone.trim() || contacts.finalPhone}
          onFail={() => toast.error(t('voters.noPhone'))}
        />
        {!phone.trim() && contacts.finalPhone ? (
          <Text variant='caption' style={{ color: outline }}>
            {t('voters.dialingChosen')}
          </Text>
        ) : null}

        {/* The shared number board: every distinct number the team proposed,
            who added each and when, and the one a super admin put in use.
            Every row is directly dialable — this is where the karykarta's
            number and the super admin's number finally live side by side. */}
        <Card style={styles.card}>
          <Text variant='subtitle'>{t('voters.phoneNumbers')}</Text>
          <Text variant='caption' style={{ color: outline }}>
            {t('voters.phoneNumbersHint')}
          </Text>
          {contacts.loading ? (
            <Text variant='caption' style={{ color: outline }}>
              {t('common.loading')}
            </Text>
          ) : contacts.groups.length === 0 ? (
            <Text variant='caption' style={{ color: outline }}>
              {t('voters.noNumbers')}
            </Text>
          ) : (
            contacts.groups.map((group) => (
              <View
                key={group.key}
                style={[styles.numberBlock, { borderTopColor: border }]}
              >
                <View style={styles.numberHead}>
                  <Text variant='subtitle' selectable>
                    {group.phone}
                  </Text>
                  {group.isFinal ? (
                    <Badge variant='secondary'>{t('voters.numberInUse')}</Badge>
                  ) : null}
                </View>
                {group.authors.map((author) => (
                  <Text
                    key={author.uid}
                    variant='caption'
                    style={{ color: outline }}
                  >
                    {t('voters.numberAddedBy', { name: author.authorName })} ·{' '}
                    {t('common.ago', {
                      time: formatDurationLong(
                        Math.max(0, now - author.updatedAt),
                        i18n.language
                      ),
                    })}
                  </Text>
                ))}
                {group.isFinal && contacts.finalized ? (
                  <Text variant='caption' style={{ color: outline }}>
                    {t('voters.chosenBy', {
                      name: contacts.finalized.finalizedName,
                    })}
                  </Text>
                ) : null}
                <View style={styles.numberActions}>
                  <ContactActions
                    compact
                    phone={group.phone}
                    onFail={() => toast.error(t('voters.noPhone'))}
                  />
                  {contacts.canFinalize ? (
                    group.isFinal ? (
                      <Button size='sm' variant='ghost' onPress={() => void stopUsing()}>
                        {t('voters.stopUsingNumber')}
                      </Button>
                    ) : (
                      <Button size='sm' variant='outline' onPress={() => void chooseNumber(group)}>
                        {t('voters.useNumber')}
                      </Button>
                    )
                  ) : null}
                </View>
              </View>
            ))
          )}
        </Card>

        <Input
          label={t('voters.jati')}
          value={jati}
          onChangeText={setJati}
          placeholder={t('voters.jatiPlaceholder')}
        />

        {/* --- Fieldwork: committed one tap at a time, not via Save --- */}
        <Card style={styles.card}>
          <Text variant='subtitle'>{t('voters.voted')}</Text>
          <View style={styles.segment}>
            {(
              [
                ['voted', t('voters.votedYes'), CheckCircle2],
                ['notVoted', t('voters.votedNo'), XCircle],
                ['unknown', t('voters.votedUnknown'), Circle],
              ] as [VotedStatus, string, typeof Circle][]
            ).map(([value, label, glyph]) => {
              const active = voter.voted === value;
              const colors = segmentColors(VOTED_TONE[value], active, tonePalette);
              return (
                <Pressable
                  key={value}
                  onPress={() => void saveNow({ voted: value }, 'voted')}
                  style={[
                    styles.segmentItem,
                    {
                      backgroundColor: colors.backgroundColor,
                      borderColor: colors.borderColor,
                    },
                  ]}
                  accessibilityRole='button'
                  accessibilityState={{ selected: active }}
                >
                  <Icon name={glyph} size={16} color={colors.color} />
                  <Text variant='caption' style={{ color: colors.color }}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={[styles.divider, { backgroundColor: border }]} />

          {/* Support was a select — a dropdown for the one field that says
              which side this voter is on. As a segment it is one tap, and
              the colours (green / red) carry the meaning before the label
              is even read. */}
          <Text variant='subtitle'>{t('voters.support')}</Text>
          <View style={styles.segment}>
            {SUPPORTS.map((value) => {
              const active = (voter.support ?? 'unknown') === value;
              const colors = segmentColors(SUPPORT_TONE[value], active, tonePalette);
              return (
                <Pressable
                  key={value}
                  onPress={() => void saveNow({ support: value }, 'support')}
                  style={[
                    styles.segmentItem,
                    {
                      backgroundColor: colors.backgroundColor,
                      borderColor: colors.borderColor,
                    },
                  ]}
                  accessibilityRole='button'
                  accessibilityState={{ selected: active }}
                >
                  <Text variant='caption' style={{ color: colors.color }}>
                    {SUPPORT_BADGE[value]}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={[styles.divider, { backgroundColor: border }]} />

          <Text variant='subtitle'>{t('voters.leaning')}</Text>
          <View style={styles.segment}>
            {LEANING.map((value) => {
              const active = voter.leaning === value;
              const colors = segmentColors(
                leaningSegmentTone(value),
                active,
                tonePalette
              );
              return (
                <Pressable
                  key={value}
                  onPress={() => void saveNow({ leaning: value }, 'leaning')}
                  style={[
                    styles.segmentItem,
                    {
                      backgroundColor: colors.backgroundColor,
                      borderColor: colors.borderColor,
                    },
                  ]}
                  accessibilityRole='button'
                  accessibilityState={{ selected: active }}
                >
                  <Text variant='caption' style={{ color: colors.color }}>
                    {LEANING_BADGE[value]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Card>

        <Card style={styles.card}>
          <View style={styles.headRow}>
            <Text variant='subtitle'>{t('voters.location')}</Text>
            {voter.location ? (
              <Pressable
                onPress={() => void showMaps()}
                hitSlop={8}
                style={styles.inlineAction}
              >
                <Icon name={MapPin} size={16} color={outline} />
                <Text variant='caption'>{t('voters.openMaps')}</Text>
              </Pressable>
            ) : null}
          </View>

          {voter.location ? (
            // Coordinates alone do not tell a karykarta whether the fix is any
            // good, so the card leads with accuracy and *when* it was taken —
            // a reading from this morning and one from last week are not the
            // same evidence, and only the timestamp distinguishes them.
            <View style={{ gap: 2 }}>
              <Text variant='caption' style={{ color: outline }}>
                {voter.location.accuracy != null
                  ? t('voters.locationAccuracy', {
                      m: Math.round(voter.location.accuracy),
                    })
                  : t('voters.locationNoAccuracy')}
              </Text>
              <Text variant='caption' style={{ color: outline }}>
                {`${voter.location.lat.toFixed(5)}, ${voter.location.lng.toFixed(5)}`}
              </Text>
              <Text variant='caption' style={{ color: outline }}>
                {t('voters.locationTaken', {
                  when: formatDateTime(voter.location.updatedAt),
                })}
              </Text>
            </View>
          ) : (
            <Text variant='caption' style={{ color: outline }}>
              {t('voters.locationNone')}
            </Text>
          )}

          <Button
            size='sm'
            variant='outline'
            icon={Crosshair}
            loading={busy === 'location'}
            disabled={busy !== null}
            onPress={() => void captureLocation()}
          >
            {t('voters.addLocation')}
          </Button>
        </Card>

        <Input
          label={t('voters.notes')}
          value={note}
          onChangeText={setNote}
          // `type='textarea'`, not a raw `multiline` prop: `Input` switches its
          // whole layout (stacked label, `rows` line-height, top-aligned text)
          // off that prop. Passing `multiline` alone left it rendered as a
          // single-line row with the text vertically centred.
          type='textarea'
          rows={4}
          placeholder={t('voters.notesPlaceholder')}
        />

        {/* Roll provenance — the four identifiers that are *not* editable,
            because correcting them would desync this row from the CSV it came
            from. Kept visible rather than folded into the header so a
            karykarta can confirm they are looking at the right person. */}
        <Card style={styles.card}>
          <Text variant='subtitle'>{t('voters.rollInfo')}</Text>
          <DetailRow
            label={t('common.ward')}
            value={t('voters.ward', { no: voter.wardNo })}
          />
          <DetailRow label={t('voters.epic')} value={voter.epicId} />
          <DetailRow
            label={t('voters.relation')}
            value={voter.relationLabel}
            hint={String(voter.serialNo)}
          />
          <DetailRow
            label={t('voters.pdfPage', { no: voter.pdfPage })}
            value={`#${voter.pdfPage}`}
          />
        </Card>
      </ScrollView>

      {/* Save lives OUTSIDE the ScrollView.
          Padding alone cannot guarantee it is visible: the form is taller than
          any phone, so the button sits below the fold and the user has to
          discover that it scrolls to reach it. As a pinned footer it is always
          on screen, which also means it stays put while the keyboard is up.
          The bottom padding clears the floating tab bar, which is an absolute
          overlay and contributes no height of its own — see
          `components/nav/floating-tab-bar.tsx`. */}
      <View style={styles.footer}>
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
        <Text variant='caption' style={[styles.hint, { color: outline }]}>
          {queueSize > 0
            ? `${t('voters.pendingSync')} · ${queueSize}`
            : t('voters.savedLocally')}
        </Text>
      </View>

      {/* Lightbox — the whole backdrop is the close target (tap or system
          back via `onRequestClose`), so the photo can be inspected at full
          size one-handed. Mounted only while open: nothing hidden in the
          tree, and no Modal competing with the edit sheet's own state. */}
      {lightboxOpen && photoSource ? (
        <Modal
          visible
          transparent
          animationType='fade'
          statusBarTranslucent
          onRequestClose={() => setLightboxOpen(false)}
        >
          <Pressable
            style={styles.lightbox}
            onPress={() => setLightboxOpen(false)}
            accessibilityRole='button'
            accessibilityLabel={t('common.close')}
          >
            <RNImage
              source={photoSource}
              style={styles.lightboxImage}
              resizeMode='contain'
            />
            {/* Fixed light ink: the backdrop is black in BOTH themes, so
                the theme's own text token would be black-on-black in dark
                mode. */}
            <View style={styles.lightboxHint} pointerEvents='none'>
              <Text variant='caption' style={{ color: 'rgba(255,255,255,0.85)' }}>
                {t('common.close')}
              </Text>
            </View>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // No large bottom padding here any more: the Save footer is a sibling of the
  // ScrollView, so the content only needs to clear its own last card.
  body: { flexGrow: 1, padding: 20, paddingTop: 12, paddingBottom: 24, gap: 14 },
  footer: {
    gap: 6,
    paddingHorizontal: 20,
    paddingTop: 12,
    // Clears the floating tab bar (pill + its 12px lift + the bottom inset).
    paddingBottom: 112,
  },
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
  card: { gap: 12 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  identityText: { flex: 1, gap: 3, minWidth: 0 },
  intentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  photoBox: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    borderRadius: CONTROL_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  photoFill: { borderRadius: 0 },
  placeholderText: { fontSize: 10 },
  photoBusy: {
    // Spelled out rather than `...StyleSheet.absoluteFillObject`: that is a
    // registered style ID in this RN version's typings, not a spreadable
    // object, so spreading it silently dropped the overlay entirely.
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  numberBlock: {
    gap: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
    marginTop: 2,
  },
  numberHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  numberActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 4,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  segment: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  segmentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    // Fixed 34 — the EXACT height of `Chip` (campaign/chip.tsx), which is
    // what renders the badges a screen above. The old padding-derived
    // height made the text-only support/leaning pills visibly shorter than
    // those badges while the icon-bearing voted pills came out taller
    // again: three different pill sizes in one card. One number, content
    // centered inside it.
    height: 34,
    paddingHorizontal: 12,
    borderRadius: CORNERS,
    borderWidth: StyleSheet.hairlineWidth,
  },
  inlineAction: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  // Height only — the colour is applied at each call site from the `border`
  // token, because a hardcoded light-theme hex (#E4E7F0) rendered as a
  // near-white line across the dark theme's cards.
  divider: { height: StyleSheet.hairlineWidth },
  lightbox: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  lightboxImage: { width: '100%', height: '80%' },
  lightboxHint: { position: 'absolute', bottom: 48, alignSelf: 'center' },
});
