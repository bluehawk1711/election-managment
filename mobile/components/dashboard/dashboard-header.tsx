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
  onSearch: () => void;
};

/**
 * Custom dashboard header — brandmark, title stack, search.
 *
 * The avatar that used to sit here has been removed: `GreetingRow` directly
 * below renders the same initials (with a presence dot) and is the more
 * expressive identity element, so keeping a second one stacked ~60pt above it
 * read as the same person twice and added a duplicate route to Settings. This
 * row is now purely *utility* (brand + search) and the greeting row is purely
 * *personal* (identity + notifications + settings) — a clean split instead of
 * two competing headers.
 */
export function DashboardHeader({ title, subtitle, onSearch }: Props) {
  const insets = useSafeAreaInsets();
  const primary = useColor('primary');
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
      <Pressable onPress={onSearch} hitSlop={12} accessibilityRole='button' accessibilityLabel='Search'>
        <Icon name={Search} size={20} />
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
});
