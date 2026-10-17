/**
 * Fieldwork card — the dashboard's "filled/edited" answer (user demand #6).
 *
 * Four counters in a row (edited, phones, photos, voted) over one progress
 * rail of edited/total, plus the pending-sync count as the hint line so a
 * user on a second device can tell "synced work" from "work still on the
 * other phone". Layout mirrors the mock's coverage section: rail first,
 * numbers under it — the rail is the at-a-glance signal, the tiles are the
 * detail.
 */
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { View } from '@/components/ui/view';
import { useColor } from '@/hooks/useColor';
import type { FieldworkStats } from '@/lib/roll/fieldwork';
import { Phone, CheckCircle2, Camera, PencilLine } from 'lucide-react-native';
import { StyleSheet } from 'react-native';

type Props = {
  stats: FieldworkStats;
  ratio: number;
  queued: number;
  title: string;
  /** e.g. "312 of 6855 voters" under the rail. */
  coverageLabel: string;
  tiles: { edited: string; phones: string; photos: string; voted: string };
  pendingLabel: string;
};

const TILES = [
  { key: 'edited', icon: PencilLine },
  { key: 'phones', icon: Phone },
  { key: 'photos', icon: Camera },
  { key: 'voted', icon: CheckCircle2 },
] as const;

export function FieldworkCard({
  stats,
  ratio,
  queued,
  title,
  coverageLabel,
  tiles,
  pendingLabel,
}: Props) {
  const primary = useColor('primary');
  const muted = useColor('muted');
  const outline = useColor('outline');
  // Hoisted OUT of the tile map below: `useColor` is a hook, and hooks may
  // not run inside a callback — even a callback over a constant array, which
  // would pass the runtime test and fail the lint rule that keeps the next
  // person from making it non-constant.
  const tileColors = {
    edited: useColor('primary'),
    phones: useColor('green'),
    photos: useColor('blue'),
    voted: useColor('purple'),
  } as const;
  const tileValues = {
    edited: stats.edited,
    phones: stats.phones,
    photos: stats.photos,
    voted: stats.voted,
  } as const;

  return (
    <View style={styles.root}>
      <Text variant='subtitle'>{title}</Text>

      {/* Rail — same shape as CoverageCard's rails so the dashboard speaks
          one visual language for "how far along". */}
      <View style={[styles.track, { backgroundColor: muted }]}>
        <View
          style={[
            styles.fill,
            {
              backgroundColor: primary,
              width: `${Math.round(ratio * 100)}%`,
            },
          ]}
        />
      </View>
      <Text variant='caption' style={{ color: outline }}>
        {coverageLabel}
      </Text>

      <View style={styles.tiles}>
        {TILES.map((tile) => {
          const color = tileColors[tile.key];
          return (
            <View key={tile.key} style={styles.tile}>
              <Icon name={tile.icon} size={14} color={color} />
              <Text variant='title'>{tileValues[tile.key]}</Text>
              <Text variant='caption' numberOfLines={1} style={{ color: outline }}>
                {tiles[tile.key]}
              </Text>
            </View>
          );
        })}
      </View>

      {queued > 0 ? (
        <Text variant='caption' style={{ color: outline }}>
          {pendingLabel}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 8 },
  track: {
    height: 8,
    borderRadius: 999,
    overflow: 'hidden',
  },
  fill: { height: 8, borderRadius: 999 },
  tiles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tile: {
    flexGrow: 1,
    flexBasis: '22%',
    minWidth: 72,
    gap: 2,
    padding: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(128,128,128,0.35)',
    alignItems: 'flex-start',
  },
});