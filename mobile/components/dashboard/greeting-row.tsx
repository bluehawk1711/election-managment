import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { View } from '@/components/ui/view';
import { useColor } from '@/hooks/useColor';
import { typeStyle } from '@/theme/typography';
import { Bell, SlidersHorizontal } from 'lucide-react-native';
import { Pressable, StyleSheet } from 'react-native';

type Props = {
  greeting: string;
  meta: string;
  initials: string;
  onBell: () => void;
  onTune: () => void;
  bellLabel: string;
  tuneLabel: string;
};

/** Greeting line — avatar with presence dot, day counter, bell + tune. */
export function GreetingRow({ greeting, meta, initials, onBell, onTune, bellLabel, tuneLabel }: Props) {
  const green = useColor('success');
  const secondary = useColor('secondary');
  const primary = useColor('primary');
  const outline = useColor('outline');
  const surface = useColor('muted');

  return (
    <View style={styles.root}>
      <View style={[styles.avatarWrap, { backgroundColor: secondary }]}>
        <Text style={[typeStyle('labelMd'), { color: primary }]}>{initials}</Text>
        <View style={[styles.dot, { backgroundColor: green }]} />
      </View>
      <View style={styles.text}>
        <Text style={typeStyle('headlineSm')} numberOfLines={1}>
          {greeting}
        </Text>
        <Text variant='caption' numberOfLines={1} style={{ color: outline }}>
          {meta}
        </Text>
      </View>
      <Pressable
        onPress={onBell}
        hitSlop={8}
        accessibilityRole='button'
        accessibilityLabel={bellLabel}
        style={[styles.iconBtn, { backgroundColor: surface }]}
      >
        <Icon name={Bell} size={17} />
      </Pressable>
      <Pressable
        onPress={onTune}
        hitSlop={8}
        accessibilityRole='button'
        accessibilityLabel={tuneLabel}
        style={[styles.iconBtn, { backgroundColor: surface }]}
      >
        <Icon name={SlidersHorizontal} size={17} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatarWrap: {
    width: 42,
    height: 42,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    position: 'absolute',
    right: 0,
    bottom: 1,
    width: 11,
    height: 11,
    borderRadius: 999,
    borderWidth: 2,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
