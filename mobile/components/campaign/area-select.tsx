import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { View } from '@/components/ui/view';
import { useColor } from '@/hooks/useColor';
import { useReference } from '@/providers/reference-provider';
import { CONTROL_RADIUS } from '@/theme/globals';
import { typeStyle } from '@/theme/typography';
import { Check, ChevronDown, MapPin } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';

/**
 * The bundled fallback for when the Firestore `areas` collection has not been
 * seeded yet — the app ships one roll (Veernagar), so an EMPTY database must
 * still render a working selector rather than an empty pill. Once
 * `scripts/seed-roll.mjs` has written `areas/veernagar`, the live list wins
 * and this array only covers the cold-start frame before the snapshot lands.
 */
export const AREAS = [
  { value: 'veernagar', labelKey: 'areas.veernagar' },
] as const;

export type AreaId = (typeof AREAS)[number]['value'];

type Props = {
  value: string;
  onChange: (value: string) => void;
};

/**
 * Compact area selector — a pill in the screen header, not a full-width
 * `SelectField`.
 *
 * A 56pt select on top of the search/filter stack would push the list down
 * again, which is exactly what the header de-cluttering just removed. This
 * is one 36pt row: map pin, current area, chevron. It opens the same
 * bottom-sheet picker every other select in the app uses, so the interaction
 * is already known — and with a single area the sheet simply shows the one
 * choice with it ticked, which still *teaches* where area switching will
 * live when the second roll arrives.
 */
export function AreaSelect({ value, onChange }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const card = useColor('card');
  const border = useColor('border');
  const outline = useColor('outline');
  const primary = useColor('primary');
  const muted = useColor('muted');
  const accent = useColor('accent');

  // Live area list (Firestore `areas`, seeded by scripts/seed-roll.mjs) with
  // the bundled Veernagar entry as the fallback — categorising the roll by
  // area is data, not a hard-coded label, and this selector is where the
  // second area will appear with no layout change at all.
  //
  // Filtered to the ROLL's constituency id: the demo campaign seed also
  // writes `areas` documents (`area-ratanada-chowk`, …) into the same
  // collection, and those are geography for tasks/booths — not datasets a
  // voter roll should be switched to.
  const { areas } = useReference();
  const live = areas.filter(
    (area) => area.constituencyId === 'cons-jodhpur-jhanwar'
  );
  const options = live.length
    ? live.map((area) => ({ value: area.id, label: area.name }))
    : AREAS.map((area) => ({
        value: area.value,
        label: t(area.labelKey as 'areas.veernagar'),
      }));
  const selected = options.find((option) => option.value === value);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole='button'
        accessibilityState={{ expanded: open }}
        accessibilityLabel={t('areas.label')}
        style={({ pressed }) => [
          styles.pill,
          {
            backgroundColor: pressed ? accent : card,
            borderColor: border,
          },
        ]}
      >
        <Icon name={MapPin} size={15} color={primary} />
        <Text style={[typeStyle('labelMd')]}>
          {selected?.label ?? t('areas.veernagar')}
        </Text>
        <Icon name={ChevronDown} size={14} color={outline} />
      </Pressable>

      <BottomSheet
        isVisible={open}
        onClose={() => setOpen(false)}
        title={t('areas.label')}
        snapPoints={[0.35]}
      >
        <View style={styles.list}>
          {options.map((option) => {
            const isActive = option.value === value;
            return (
              <Pressable
                key={option.value}
                onPress={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                style={[
                  styles.option,
                  { backgroundColor: isActive ? muted : card },
                ]}
                accessibilityRole='button'
                accessibilityState={{ selected: isActive }}
              >
                <Icon name={MapPin} size={18} color={primary} />
                <Text style={[typeStyle('bodyMd'), styles.optionLabel]}>
                  {option.label}
                </Text>
                {isActive ? <Icon name={Check} size={18} color={primary} /> : null}
              </Pressable>
            );
          })}
        </View>
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: CONTROL_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    // 36pt visual + 4pt slop = 44pt effective target.
    flexGrow: 0,
  },
  list: { gap: 6 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: CONTROL_RADIUS,
  },
  optionLabel: { flex: 1 },
});
