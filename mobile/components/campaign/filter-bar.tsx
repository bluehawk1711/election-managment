import { Chip } from '@/components/campaign/chip';
import { ScrollView, StyleSheet, ViewStyle } from 'react-native';

export type FilterItem = {
  key: string;
  label: string;
  active: boolean;
};

type Props = {
  items: FilterItem[];
  onToggle: (key: string) => void;
  style?: ViewStyle;
};

/** Horizontally scrolling pill filters — single-select semantics per key. */
export function FilterBar({ items, onToggle, style }: Props) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.content, style]}
      style={styles.scroll}
    >
      {items.map((item) => (
        <Chip
          key={item.key}
          label={item.label}
          active={item.active}
          onPress={() => onToggle(item.key)}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 0,
  },
  content: {
    gap: 8,
    paddingRight: 20,
  },
});
