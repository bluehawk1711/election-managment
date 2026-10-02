import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { View } from '@/components/ui/view';
import { useColor } from '@/hooks/useColor';
import { typeStyle } from '@/theme/typography';
import { LucideProps } from 'lucide-react-native';
import { Pressable, StyleSheet } from 'react-native';

type Props = {
  icon: React.ComponentType<LucideProps>;
  label: string;
  onPress: () => void;
  /** Semantic tone that tints the icon tile. */
  tone?: 'primary' | 'warning' | 'danger' | 'info';
};

const TONE: Record<NonNullable<Props['tone']>, { bg: Parameters<typeof useColor>[0]; fg: Parameters<typeof useColor>[0] }> = {
  primary: { bg: 'accent', fg: 'primary' },
  warning: { bg: 'secondary', fg: 'warning' },
  danger: { bg: 'secondary', fg: 'error' },
  info: { bg: 'secondary', fg: 'info' },
};

/** Dashboard quick action — tinted icon tile with a short label. */
export function QuickAction({ icon, label, onPress, tone = 'primary' }: Props) {
  const { bg, fg } = TONE[tone];
  const bgColor = useColor(bg);
  const fgColor = useColor(fg);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole='button'
      accessibilityLabel={label}
      style={({ pressed }) => [styles.root, { opacity: pressed ? 0.7 : 1 }]}
    >
      <View style={[styles.tile, { backgroundColor: bgColor }]}>
        <Icon name={icon} size={20} color={fgColor} />
      </View>
      <Text style={[typeStyle('labelMd'), styles.label]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  tile: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    textAlign: 'center',
  },
});
