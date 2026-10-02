import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { View } from '@/components/ui/view';
import { Icon } from '@/components/ui/icon';
import { useColor } from '@/hooks/useColor';
import { typeStyle } from '@/theme/typography';
import { LucideProps } from 'lucide-react-native';
import { StyleSheet } from 'react-native';

type Props = {
  icon: React.ComponentType<LucideProps>;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
};

/** Calm centered empty state — icon medallion, title, body, optional action. */
export function EmptyState({ icon, title, body, actionLabel, onAction }: Props) {
  const muted = useColor('muted');
  const outline = useColor('outline');

  return (
    <View style={styles.root}>
      <View style={[styles.medallion, { backgroundColor: muted }]}>
        <Icon name={icon} size={26} />
      </View>
      <Text style={[typeStyle('headlineSm'), styles.title]}>{title}</Text>
      {body ? (
        <Text variant='caption' style={[styles.body, { color: outline }]}>
          {body}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button variant='outline' size='sm' onPress={onAction} style={styles.action}>
          {actionLabel}
        </Button>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 24,
    gap: 8,
  },
  medallion: {
    width: 56,
    height: 56,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  title: {
    textAlign: 'center',
  },
  body: {
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 18,
  },
  action: {
    marginTop: 8,
  },
});
