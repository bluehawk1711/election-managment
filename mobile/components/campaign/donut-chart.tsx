import { Text } from '@/components/ui/text';
import { View } from '@/components/ui/view';
import { useColor } from '@/hooks/useColor';
import { typeStyle } from '@/theme/typography';
import React from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

export type DonutSegment = {
  label: string;
  value: number;
  color: string;
};

type Props = {
  segments: DonutSegment[];
  size?: number;
  strokeWidth?: number;
  totalLabel?: string;
};

/** Donut + legend — issues by category on the dashboard. */
export function DonutChart({ segments, size = 140, strokeWidth = 16, totalLabel }: Props) {
  const muted = useColor('muted');
  const outline = useColor('outline');
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;

  return (
    <View style={styles.root}>
      <View style={[styles.chartWrap, { width: size, height: size }]}>
        <Svg width={size} height={size}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={muted}
            strokeWidth={strokeWidth}
            fill='none'
          />
          {total > 0
            ? segments.map((segment) => {
                const fraction = segment.value / total;
                const length = fraction * circumference;
                const dashOffset = -offset;
                offset += length;
                return (
                  <Circle
                    key={segment.label}
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    stroke={segment.color}
                    strokeWidth={strokeWidth}
                    strokeDasharray={`${length} ${circumference - length}`}
                    strokeDashoffset={dashOffset}
                    strokeLinecap='butt'
                    fill='none'
                    transform={`rotate(-90 ${size / 2} ${size / 2})`}
                  />
                );
              })
            : null}
        </Svg>
        <View style={styles.center} pointerEvents='none'>
          <Text style={[typeStyle('headlineLg')]}>{total}</Text>
          {totalLabel ? (
            <Text variant='caption' style={{ color: outline }}>
              {totalLabel}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.legend}>
        {segments.map((segment) => {
          const share = total > 0 ? Math.round((segment.value / total) * 100) : 0;
          return (
            <View key={segment.label} style={styles.legendRow}>
              <View style={[styles.dot, { backgroundColor: segment.color }]} />
              <Text variant='caption' style={styles.legendLabel} numberOfLines={1}>
                {segment.label}
              </Text>
              <Text variant='caption' style={[typeStyle('labelMd'), { color: outline }]}>
                {segment.value} ({share}%)
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  chartWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  legend: {
    flex: 1,
    gap: 8,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  legendLabel: {
    flex: 1,
  },
});
