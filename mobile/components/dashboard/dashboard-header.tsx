import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { View } from '@/components/ui/view';
import { useColor } from '@/hooks/useColor';
import { typeStyle } from '@/theme/typography';
import { Search, Vote } from 'lucide-react-native';
import { Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  title: string;
  subtitle: string;
  initials: string;
  onSearch: () => void;
  onAvatar: () => void;
};

/** Custom dashboard header — brandmark, title stack, search, avatar. */
export function DashboardHeader({ title, subtitle, initials, onSearch, onAvatar }: Props) {
  const insets = useSafeAreaInsets();
  const primary = useColor('primary');
  const card = useColor('card');
  const outline = useColor('outline');

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <View style={[styles.brandmark, { backgroundColor: primary }]}>
        <Icon name={Vote} size={20} color='#fff' />
      </View>
      <View style={styles.titles}>
        <Text style={typeStyle('headlineMd')}>{title}</Text>
        <Text variant='caption' style={{ color: outline }}>
          {subtitle}
        </Text>
      </View>
      <Pressable onPress={onSearch} hitSlop={8} accessibilityRole='button' accessibilityLabel='Search'>
        <Icon name={Search} size={20} />
      </Pressable>
      <Pressable onPress={onAvatar} hitSlop={8} accessibilityRole='button' accessibilityLabel={title}>
        <View style={[styles.avatar, { backgroundColor: card }]}>
          <Text style={[typeStyle('labelSm'), { color: primary }]}>{initials}</Text>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  brandmark: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titles: {
    flex: 1,
    gap: 1,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
