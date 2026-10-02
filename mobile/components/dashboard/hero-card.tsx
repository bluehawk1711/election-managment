import { Text } from '@/components/ui/text';
import { View } from '@/components/ui/view';
import { useColor } from '@/hooks/useColor';
import { typeStyle } from '@/theme/typography';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';

type Props = {
  title: string;
  trendLabel: string | null;
  index: number;
  indexLabel: string;
  stats: { label: string; value: string }[];
};

const GRID_COLOR = 'rgba(255,255,255,0.08)';

/** Gradient readiness hero — grid texture, radial index ring, three stats. */
export function HeroCard({ title, trendLabel, index, indexLabel, stats }: Props) {
  const primary = useColor('primary');

  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.max(0, Math.min(100, index));
  const dash = (progress / 100) * circumference;

  return (
    <LinearGradient
      colors={[primary, '#2100BD']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.root}
    >
      <Svg style={StyleSheet.absoluteFill} width='100%' height='100%' pointerEvents='none'>
        {Array.from({ length: 9 }, (_, i) => (
          <Line key={`v${i}`} x1={(i * 100) / 8 + '%'} y1='0' x2={(i * 100) / 8 + '%'} y2='100%' stroke={GRID_COLOR} strokeWidth={1} />
        ))}
        {Array.from({ length: 7 }, (_, i) => (
          <Line key={`h${i}`} x1='0' y1={(i * 100) / 6 + '%'} x2='100%' y2={(i * 100) / 6 + '%'} stroke={GRID_COLOR} strokeWidth={1} />
        ))}
      </Svg>

      <View style={styles.header}>
        <Text style={[typeStyle('headlineSm'), { color: '#fff' }]}>{title}</Text>
        {trendLabel ? (
          <View style={[styles.trend, { backgroundColor: 'rgba(255,255,255,0.18)' }]}>
            <Text style={[typeStyle('labelSm'), { color: '#fff' }]}>{trendLabel}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.ringWrap}>
        <Svg width={120} height={120}>
          <Circle cx={60} cy={60} r={radius} stroke='rgba(255,255,255,0.22)' strokeWidth={10} fill='none' />
          <Circle
            cx={60}
            cy={60}
            r={radius}
            stroke='#fff'
            strokeWidth={10}
            fill='none'
            strokeDasharray={`${dash} ${circumference - dash}`}
            strokeLinecap='round'
            transform='rotate(-90 60 60)'
          />
        </Svg>
        <View style={styles.ringCenter} pointerEvents='none'>
          <Text style={[typeStyle('headlineXl'), styles.ringValue]}>{progress}%</Text>
          <Text style={[typeStyle('labelSm'), styles.ringLabel]}>{indexLabel}</Text>
        </View>
      </View>

      <View style={styles.stats}>
        {stats.map((stat) => (
          <View key={stat.label} style={styles.stat}>
            <Text style={[typeStyle('metric'), { color: '#fff', fontVariant: ['tabular-nums'] }]}>
              {stat.value}
            </Text>
              <Text style={[typeStyle('labelSm'), styles.statLabel]}>{stat.label}</Text>
          </View>
        ))}
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: {
    borderRadius: 20,
    padding: 20,
    gap: 18,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  trend: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  ringWrap: {
    alignSelf: 'center',
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringCenter: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringValue: {
    color: '#fff',
    fontVariant: ['tabular-nums'],
  },
  ringLabel: {
    color: 'rgba(255,255,255,0.8)',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  stats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  statLabel: {
    color: 'rgba(255,255,255,0.78)',
    textAlign: 'center',
  },
});
