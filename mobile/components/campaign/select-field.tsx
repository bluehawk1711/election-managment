import { Icon } from '@/components/ui/icon';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Text } from '@/components/ui/text';
import { View } from '@/components/ui/view';
import { useColor } from '@/hooks/useColor';
import { CONTROL_RADIUS } from '@/theme/globals';
import { typeStyle } from '@/theme/typography';
import { Check, ChevronDown } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';

export type SelectOption = {
  value: string;
  label: string;
};

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
        snapPoints={[0.5]}
      >
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
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
                <Text style={[typeStyle('bodyMd'), { flex: 1 }]}>{option.label}</Text>
                {isActive ? <Icon name={Check} size={18} color={primary} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
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
    maxHeight: 340,
  },
  listContent: {
    gap: 6,
    paddingBottom: 20,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: CONTROL_RADIUS,
  },
});
