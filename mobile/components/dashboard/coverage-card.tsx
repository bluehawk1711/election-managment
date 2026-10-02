import { ProgressRail } from '@/components/campaign/progress-rail';
import { SectionHeader } from '@/components/campaign/section-header';
import { View } from '@/components/ui/view';
import { useMemo } from 'react';

type Rail = { wardId: string; label: string; ratio: number };

type Props = {
  rails: Rail[];
  title: string;
  subtitle: string;
  hint?: string;
  target?: number;
};

/** Booth coverage by ward — sorted rails, threshold warning built in. */
export function CoverageCard({ rails, title, subtitle, hint, target = 60 }: Props) {
  const sorted = useMemo(
    () => [...rails].sort((a, b) => b.ratio - a.ratio).slice(0, 6),
    [rails]
  );

  return (
    <View style={{ gap: 12 }}>
      <SectionHeader title={title} subtitle={subtitle} hint={hint} />
      <View style={{ gap: 12 }}>
        {sorted.map((rail) => (
          <ProgressRail
            key={rail.wardId}
            label={rail.label}
            percent={rail.ratio * 100}
            warnBelow={target}
          />
        ))}
      </View>
    </View>
  );
}
