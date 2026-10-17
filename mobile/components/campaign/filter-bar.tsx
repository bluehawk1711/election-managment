import { Chip, type ChipTone } from '@/components/campaign/chip';
import { ScrollView, StyleSheet, ViewStyle } from 'react-native';

export type FilterItem = {
  key: string;
  label: string;
  active: boolean;
  /**
   * Tone used while `active` — defaults to `primary`.
   *
   * It exists because "which filter is on?" has to be answerable at a glance:
   * the chip's `default` tone fills with the muted secondary colour, which
   * changes shape but not really colour, so an active Name/Father/Locality
   * chip looked nearly identical to an idle one on a sunlight-read phone.
   * Callers may downgrade a tone for semantics (e.g. a danger-toned toggle
   * already says what it means), never for chrome.
   */
  tone?: ChipTone;
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
          tone={item.active ? (item.tone ?? 'primary') : 'default'}
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
