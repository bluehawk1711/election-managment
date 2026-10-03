import { Icon } from '@/components/ui/icon';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Text } from '@/components/ui/text';
import { View } from '@/components/ui/view';
import { useColor } from '@/hooks/useColor';
import { CONTROL_RADIUS } from '@/theme/globals';
import { typeStyle } from '@/theme/typography';
import { Check, ChevronDown } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

export type SelectOption = {
  value: string;
  label: string;
  /** Optional second line — e.g. the area a ward covers. */
  hint?: string;
};

/**
 * Reference height the sheet-sizing maths is calibrated against.
 *
 * A constant rather than the live screen height on purpose: if the sheet height
 * tracked the device, the *fraction* passed to `snapPoints` would change meaning
 * with it, and the same thirteen wards would open half-open on a tablet and
 * nearly full on a small phone. Calibrated once against a tall phone, the sheet
 * asks for a sensible fraction everywhere.
 */
const SCREEN_HEIGHT = 640;

type Props = {
  label?: string;
  value: string;
  placeholder: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: string;
};

/** Generic bottom-sheet select — the one picker every form reuses. */
export function SelectField({
  label,
  value,
  placeholder,
  options,
  onChange,
  disabled,
  error,
}: Props) {
  const [open, setOpen] = useState(false);

  const card = useColor('card');
  const border = useColor('border');
  const outline = useColor('outline');
  const primary = useColor('primary');
  const muted = useColor('muted');
  const errorColor = useColor('error');
  const textColor = useColor('text');

  const selected = options.find((option) => option.value === value);

  /**
   * Size the sheet to the content, up to a cap.
   *
   * Pinned at `0.5` this is right for a three-option picker and badly wrong for
   * fourteen: the ward list has 13 wards plus "All", so barely five rows were
   * visible. `min(needed, cap)` opens a short list short and a long one as tall
   * as it usefully can, with the remainder scrolling in the sheet's own view.
   */
  const snapPoint = Math.min(
    0.92,
    Math.max(0.35, ((options.length * 52 + 140) / SCREEN_HEIGHT) * 100) / 100
  );

  return (
    <>
      <Pressable
        onPress={() => !disabled && setOpen(true)}
        accessibilityRole='button'
        accessibilityState={{ disabled: !!disabled, expanded: open }}
        style={[
          styles.field,
          { backgroundColor: card, borderColor: error ? errorColor : border },
          disabled && styles.disabled,
        ]}
      >
        <View style={styles.text}>
          {label ? (
            <Text variant='caption' style={{ color: outline }}>
              {label}
            </Text>
          ) : null}
          <Text
            style={[typeStyle('bodyMd'), { color: selected ? textColor : outline }]}
            numberOfLines={1}
          >
            {selected?.label ?? placeholder}
          </Text>
        </View>
        <Icon name={ChevronDown} size={18} color={outline} />
      </Pressable>

      <BottomSheet
        isVisible={open}
        onClose={() => setOpen(false)}
        title={label ?? placeholder}
        snapPoints={[snapPoint]}
      >
        {/* No ScrollView here. `BottomSheetContent` already wraps its children
            in one, and a vertically scrollable view nested inside another
            vertically scrollable view on Android does not scroll — the inner
            one never receives the gesture because the outer claims it. That is
            exactly why the ward list looked frozen: fourteen options, no way to
            reach ward 5. A plain `View` lets the sheet's own scroller do the
            work, and the sheet is already sized to the content. */}
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
                <View style={styles.optionText}>
                <Text style={typeStyle('bodyMd')}>{option.label}</Text>
                {option.hint ? (
                  <Text variant='caption' numberOfLines={2}>
                    {option.hint}
                  </Text>
                ) : null}
              </View>
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
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: CONTROL_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
  },
  text: {
    gap: 2,
    flex: 1,
  },
  disabled: {
    opacity: 0.5,
  },
  list: {
    gap: 6,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: CONTROL_RADIUS,
  },
  optionText: {
    flex: 1,
    gap: 2,
  },
});
