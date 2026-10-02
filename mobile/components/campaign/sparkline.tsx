import { useColor } from '@/hooks/useColor';
import Svg, { Path } from 'react-native-svg';

type Props = {
  /** Small ordered series (last ~7 buckets). */
  values: number[];
  /** Token name for the stroke color. */
  colorName?: string;
  width?: number;
  height?: number;
};

/** 24px sparkline for metric tiles — a single rounded stroke, no axes. */
export function Sparkline({
  values,
  colorName = 'primary',
  width = 72,
  height = 24,
}: Props) {
  const stroke = useColor(colorName as Parameters<typeof useColor>[0]);

  if (values.length < 2) {
    return <Svg width={width} height={height} />;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = width / (values.length - 1);
  const pad = 3;

  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = height - pad - ((v - min) / span) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <Svg width={width} height={height}>
      <Path
        d={`M ${points.join(' L ')}`}
        stroke={stroke}
        strokeWidth={2}
        fill='none'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </Svg>
  );
}
