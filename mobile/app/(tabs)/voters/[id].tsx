import { DetailRow } from '@/components/roll/detail-row';
import { Chip } from '@/components/campaign/chip';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Image } from '@/components/ui/image';
import { ScrollView } from '@/components/ui/scroll-view';
import { Spinner } from '@/components/ui/spinner';
import { Text } from '@/components/ui/text';
import { useToast } from '@/components/ui/toast';
import { View } from '@/components/ui/view';
import { useColor } from '@/hooks/useColor';
import { useRoll } from '@/hooks/useRoll';
import {
  compressForUpload,
  isCloudinaryConfigured,
  uploadPhoto,
} from '@/lib/cloudinary';
import {
  mapsUrl,
  openExternal,
  smsUrl,
  telUrl,
  whatsappUrl,
} from '@/lib/contact';
import {
  loadQueue,
  overlayStorage,
  putOverlay,
} from '@/lib/roll/overlay';
import type {
  Leaning,
  VotedStatus,
  VoterLocation,
  VoterOverlay,
} from '@/lib/roll/types';
import { BORDER_RADIUS } from '@/theme/globals';
import { useAuth } from '@/providers/auth-provider';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Camera,
  CheckCircle2,
  Circle,
  Crosshair,
  MapPin,
  MessageCircle,
  Pencil,
  Phone,
  XCircle,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet } from 'react-native';

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

/** The leaning options, in the order plan-voters.md §2 fixes them. */
const LEANING: Leaning[] = ['right', 'centerRight', 'center', 'centerLeft', 'left'];

/** i18n key for one leaning value (`voters.leaning.right`, …). */
const leaningKey = (value: Leaning) => `voters.leaning.${value}` as const;

/**
 * Voter detail (plan-voters.md §6.2).
 *
 * Reads the merged `VoterView` from `useRoll`; every write goes to the local
 * overlay. Nothing here can touch the base roll — that is enforced one layer
 * down, in `lib/roll/overlay.ts`, but the consequence is visible here: the
 * "Roll details" card is display-only and the "Field data" card is editable.
 */
export default function VoterDetailScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const outline = useColor('outline');
  const muted = useColor('muted');

  const params = useLocalSearchParams<{ id: string; ward?: string }>();
  const voterId = String(params.id ?? '');
  const wardParam = Number(params.ward);

  const roll = useRoll(Number.isFinite(wardParam) && wardParam > 0 ? wardParam : null);
  const voter = roll.find(voterId);

  const [busy, setBusy] = useState<string | null>(null);

  // A detail opened from a deep link has no ward in the params; load the
  // overlay for whichever ward the row reports once it arrives.
  const wardNo = voter?.wardNo ?? (Number.isFinite(wardParam) ? wardParam : null);

  // No `useCallback` here on purpose. The React Compiler already memoises
  // component-local functions, and it can only do that if there is no manual
  // memoisation to preserve — a hand-written `useCallback` whose dependency
  // list includes anything derived from the `roll` object (which `useRoll`
  // returns as a fresh literal on every render) makes the compiler skip the
  // whole component with "Existing memoization could not be preserved".
  const uid = user?.uid ?? 'local';

  const save = async (overlay: Partial<VoterOverlay>, label: string) => {
    if (wardNo == null || !voterId) return;
    setBusy(label);
    try {
      await putOverlay(overlayStorage, { voterId, wardNo, overlay, uid });
      roll.refresh();
      toast.success(t('voters.savedLocally'));
    } catch {
      toast.error(t('common.errorTitle'));
    } finally {
      setBusy(null);
    }
  };

  // Fallback used only when the overlay has to be read outside a write, e.g.
  // the queue length check below.
  //
  // The dependency is `voter?.pending` — a boolean derived from the overlay —
  // rather than `voter` itself, which is a fresh object on every render of the
  // list. Depending on the object re-runs this on every pass, and the React
  // Compiler cannot preserve that memoisation ("Existing memoization could not
  // be preserved"), which is what the lint error was reporting. Depending on
  // the one boolean that actually changes when the queue grows is both correct
  // and what the compiler can keep.
  const pending = voter?.pending ?? false;
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

  if (!voter) {
    return (
      <View style={styles.center}>
        {roll.loading ? (
          <Spinner size='lg' variant='circle' />
        ) : (
          <>
            <Text variant='caption'>{t('voters.noMatches')}</Text>
            <Button size='sm' variant='outline' onPress={() => router.back()}>
              {t('common.back')}
            </Button>
          </>
        )}
      </View>
    );
  }

  const e = voter.effective;

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
      const uploaded = await uploadPhoto(compressed.base64);
      await save(
        { photoUrl: uploaded.secureUrl, photoPublicId: uploaded.publicId },
        'photo'
      );
    } catch (caught) {
      toast.error(t('voters.photoFailed'), caught instanceof Error ? caught.message : undefined);
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
      await save({ location }, 'location');
    } catch {
      toast.error(t('voters.locationFailed'));
    } finally {
      setBusy(null);
    }
  };

  const setVoted = (voted: VotedStatus) => save({ voted }, 'voted');
  const setLeaning = (leaning: Leaning) => save({ leaning }, 'leaning');

  const openLink = async (url: string | null, failed: string) => {
    if (!url) return;
    const ok = await openExternal(url);
    if (!ok) toast.error(failed);
  };

  return (
    <View style={styles.root}>
      <ScrollViewish>
        <Card style={styles.card}>
          <View style={styles.headRow}>
            <View style={styles.headText}>
              <Text variant='heading'>{e.name}</Text>
              <Text variant='caption' style={{ color: outline }}>
                {t('voters.serial', { no: voter.serialNo })} · {voter.epicId}
              </Text>
            </View>
            <Button
              size='sm'
              variant='outline'
              icon={Pencil}
              onPress={() =>
                router.push({
                  pathname: '/(tabs)/voters/edit',
                  params: { id: voter.id, ward: String(voter.wardNo) },
                })
              }
            >
              {t('common.edit')}
            </Button>
          </View>

          {voter.pending ? (
            <Chip label={t('voters.pendingSync')} tone='primary' />
          ) : null}
        </Card>

        <Text variant='subtitle'>{t('voters.fieldwork')}</Text>

        <Card style={styles.card}>
          {/* Photo */}
          <View style={styles.photoRow}>
            <Pressable
              onPress={() => void pickPhoto()}
              style={[styles.photo, { backgroundColor: muted }]}
              accessibilityRole='button'
              accessibilityLabel={t('voters.addPhoto')}
            >
              {voter.photoUrl ? (
                <Image
                  source={{ uri: voter.photoUrl }}
                  style={styles.photoImage}
                  contentFit='cover'
                />
              ) : (
                <Camera size={22} color={outline} />
              )}
            </Pressable>
            <View style={{ flex: 1, gap: 4 }}>
              <Text>{t('voters.photo')}</Text>
              <Text variant='caption' style={{ color: outline }}>
                {busy === 'photo'
                  ? t('voters.photoUploading')
                  : isCloudinaryConfigured()
                    ? t('voters.addPhoto')
                    : t('voters.photoFailed')}
              </Text>
            </View>
            {busy === 'photo' ? <Spinner size='sm' variant='circle' /> : null}
          </View>

          {/* Location */}
          <View style={styles.divider} />
          <View style={styles.block}>
            <View style={styles.headRow}>
              <Text>{t('voters.location')}</Text>
              {voter.location ? (
                <Pressable
                  onPress={() =>
                    void openExternal(
                      mapsUrl(voter.location!.lat, voter.location!.lng)
                    )
                  }
                  hitSlop={8}
                  style={styles.inlineAction}
                >
                  <Icon name={MapPin} size={16} color={outline} />
                  <Text variant='caption'>{t('voters.openMaps')}</Text>
                </Pressable>
              ) : null}
            </View>
            {voter.location ? (
              <Text variant='caption' style={{ color: outline }}>
                {voter.location.lat.toFixed(5)}, {voter.location.lng.toFixed(5)}
                {voter.location.accuracy != null
                  ? ` · ${t('voters.locationAccuracy', {
                      m: Math.round(voter.location.accuracy),
                    })}`
                  : ''}
              </Text>
            ) : (
              <Text variant='caption' style={{ color: outline }}>
                {t('voters.location')}
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
          </View>

          {/* Voted */}
          <View style={styles.divider} />
          <View style={styles.block}>
            <Text>{t('voters.voted')}</Text>
            <View style={styles.segment}>
              {(
                [
                  ['voted', t('voters.votedYes'), CheckCircle2],
                  ['notVoted', t('voters.votedNo'), XCircle],
                  ['unknown', t('voters.votedUnknown'), Circle],
                ] as [VotedStatus, string, typeof Circle][]
              ).map(([value, label, glyph]) => {
                const active = voter.voted === value;
                return (
                  <Pressable
                    key={value}
                    onPress={() => void setVoted(value)}
                    style={[styles.segmentItem, active && styles.segmentActive]}
                    accessibilityRole='button'
                    accessibilityState={{ selected: active }}
                  >
                    <Icon
                      name={glyph}
                      size={16}
                      color={active ? '#FFFFFF' : outline}
                    />
                    <Text
                      variant='caption'
                      style={{ color: active ? '#FFFFFF' : outline }}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Leaning */}
          <View style={styles.divider} />
          <View style={styles.block}>
            <Text>{t('voters.leaning')}</Text>
            <View style={styles.segment}>
              {LEANING.map((value) => {
                const active = voter.leaning === value;
                return (
                  <Pressable
                    key={value}
                    onPress={() => void setLeaning(value)}
                    style={[styles.segmentItem, active && styles.segmentActive]}
                    accessibilityRole='button'
                    accessibilityState={{ selected: active }}
                  >
                    <Text
                      variant='caption'
                      style={{ color: active ? '#FFFFFF' : outline }}
                    >
                      {t(leaningKey(value))}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </Card>

        {/* Contact */}
        <Text variant='subtitle'>{t('voters.contact')}</Text>
        <Card style={styles.card}>
          <DetailRow label={t('common.phone')} value={e.phone} hint={t('voters.phoneHint')} />
          <View style={styles.actions}>
            <Button
              size='sm'
              variant='outline'
              icon={Phone}
              disabled={!e.phone}
              onPress={() => void openLink(telUrl(e.phone), t('voters.noPhone'))}
            >
              {t('voters.call')}
            </Button>
            <Button
              size='sm'
              variant='outline'
              icon={MessageCircle}
              disabled={!e.phone}
              onPress={() => void openLink(smsUrl(e.phone), t('voters.noPhone'))}
            >
              {t('voters.message')}
            </Button>
            <Button
              size='sm'
              variant='outline'
              icon={MessageCircle}
              disabled={!e.phone}
              onPress={() =>
                void openLink(whatsappUrl(e.phone), t('voters.noPhone'))
              }
            >
              {t('voters.whatsapp')}
            </Button>
          </View>
        </Card>

        {/* Roll details — read-only, straight from the CSV */}
        <Text variant='subtitle'>{t('voters.rollInfo')}</Text>
        <Card style={styles.card}>
          <DetailRow label={t('voters.epic')} value={voter.epicId} />
          <DetailRow label={t('voters.father')} value={e.fatherOrHusbandName} hint={voter.relationLabel} />
          <DetailRow label={t('voters.house')} value={e.houseNo} />
          <DetailRow label={String(e.age)} value={`${e.age}`} />
          <DetailRow label={t('voters.gender')} value={e.gender} />
          <DetailRow label={t('voters.locality')} value={e.locality} />
          <DetailRow
            label={t('common.ward')}
            value={t('voters.ward', { no: voter.wardNo })}
          />
          <DetailRow label={t('voters.pdfPage', { no: voter.pdfPage })} value={`#${voter.pdfPage}`} />
        </Card>

        <Text variant='caption' style={{ color: outline, textAlign: 'center' }}>
          {queueSize > 0
            ? `${t('voters.pendingSync')} · ${queueSize}`
            : t('voters.savedLocally')}
        </Text>
      </ScrollViewish>
    </View>
  );
}

/**
 * Detail body scrolls; the component is inlined rather than imported at the
 * top so this file keeps one import block for the shared UI kit.
 */
function ScrollViewish({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView
      contentContainerStyle={{
        padding: 20,
        paddingTop: 8,
        paddingBottom: 112,
        gap: 12,
      }}
      keyboardShouldPersistTaps='handled'
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 20,
  },
  card: { gap: 12 },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headText: { flex: 1, gap: 2 },
  block: { gap: 8 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#E4E7F0' },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  photo: {
    width: 64,
    height: 64,
    borderRadius: BORDER_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photoImage: { width: 64, height: 64 },
  segment: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  segmentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E4E7F0',
  },
  segmentActive: { backgroundColor: '#3B2FD6', borderColor: '#3B2FD6' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  rowValue: { flex: 1, alignItems: 'flex-end', gap: 2 },
  inlineAction: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
