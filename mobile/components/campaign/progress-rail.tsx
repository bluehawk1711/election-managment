import { Text } from '@/components/ui/text';
import { View } from '@/components/ui/view';
import { useColor } from '@/hooks/useColor';
import { typeStyle } from '@/theme/typography';
import { StyleSheet } from 'react-native';

type Props = {
  label: string;
  /** 0–100. */
  percent: number;
  /** Percent below which the row warns (default 60 per DESIGN target). */
  warnBelow?: number;
  rightLabel?: string;
};

/** Labeled coverage rail — ward/booth completion against a threshold. */
export function ProgressRail({ label, percent, warnBelow = 60, rightLabel }: Props) {
  const track = useColor('muted');
  const ok = useColor('success');
  const warn = useColor('error');
  const outline = useColor('outline');
  const warnColor = useColor('error');

  const clamped = Math.max(0, Math.min(100, percent));
  const isWarn = clamped < warnBelow;

  return (
    <View style={styles.root}>
      <View style={styles.labels}>
        <Text variant='caption' style={typeStyle('labelMd')}>
          {label}
        </Text>
        <Text variant='caption' style={[typeStyle('labelMd'), { color: isWarn ? warnColor : outline }]}>
          {rightLabel ?? `${Math.round(clamped)}%`}
        </Text>
      </View>
      <View style={[styles.track, { backgroundColor: track }]}>
        <View
          style={[
            styles.fill,
            { width: `${clamped}%`, backgroundColor: isWarn ? warn : ok },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 6,
  },
  labels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  track: {
    height: 8,
    borderRadius: 999,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 999,
  },
});
