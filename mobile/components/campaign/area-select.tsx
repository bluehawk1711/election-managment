import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { View } from '@/components/ui/view';
import { useColor } from '@/hooks/useColor';
import { CONTROL_RADIUS } from '@/theme/globals';
import { typeStyle } from '@/theme/typography';
import { Check, ChevronDown, MapPin } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';

/**
 * The selectable roll areas, keyed by the i18n label each one carries.
 *
 * One entry for now — the app ships a single roll (Veernagar). The list is
 * data, not structure: adding an area is one line here plus its translation,
 * and the pill, the sheet and the selection state all follow. The selector
 * is on screen from day one so switching areas never becomes a layout
 * change later.
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

  const options = AREAS.map((area) => ({
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
