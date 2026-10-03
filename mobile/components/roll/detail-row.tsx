import { Text } from '@/components/ui/text';
import { View } from '@/components/ui/view';
import { useColor } from '@/hooks/useColor';
import { StyleSheet } from 'react-native';

/**
 * One label/value line in a detail card, with an optional second line.
 *
 * Module-level on purpose. Defined inside a screen's render body it would be a
 * *new component type* on every render, so React unmounts and remounts the row
 * subtree instead of diffing it — on a screen holding a live Firestore
 * subscription that is a visible flicker, and it defeats every `React.memo`
 * beneath it. The colour comes from `useColor` here rather than being passed
 * down, which is what lets the component live outside the screen without
 * threading a prop through every call site.
 *
 * It lives under `components/` and not inside `app/` because **every** file in
 * `app/` is a route as far as expo-router is concerned: a shared component
 * dropped in there is announced as `Route "./(tabs)/voters/_row.tsx" is missing
 * the required default export` and, worse, is a navigation target with no
 * screen behind it.
 */
export function DetailRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  const outline = useColor('outline');

  return (
    <View style={styles.row}>
      <Text variant='caption' style={{ color: outline }}>
        {label}
      </Text>
      <View style={styles.rowValue}>
        <Text>{value || '—'}</Text>
        {hint ? (
          <Text variant='caption' style={{ color: outline }}>
            {hint}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  rowValue: { flexShrink: 1, alignItems: 'flex-end' },
});