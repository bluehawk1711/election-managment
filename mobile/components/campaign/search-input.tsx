import { Input } from '@/components/ui/input';
import { Search, X } from 'lucide-react-native';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, type TextInput } from 'react-native';

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
};

/**
 * Search field with a leading icon and a one-tap clear affordance.
 *
 * ## Why the clear button owns its own press
 *
 * `Input` wraps the field in a `Pressable` that focuses the `TextInput`. When
 * the ✕ was a plain `Pressable` child of that wrapper, pressing it fired *both*
 * handlers: the clear set the text to `''`, and the wrapper immediately
 * re-focused the field. The re-focus is what made clearing feel broken — the
 * keyboard stayed up and, because the list re-filters synchronously on every
 * keystroke, the rows snapped back while focus was still being restored.
 *
 * Calling `stopPropagation` is not available for this case on Android, so the
 * fix is to make the button *unambiguous* rather than to try to cancel the
 * event: it now clears, keeps focus in the field deliberately (so typing can
 * continue without a second tap), and the touch target is enlarged to the
 * 44pt minimum rather than a 16pt icon floating inside a text row.
 */
export function SearchInput({ value, onChangeText, placeholder, autoFocus }: Props) {
  const { t } = useTranslation();
  const inputRef = useRef<TextInput>(null);

  const clear = () => {
    onChangeText('');
    // Focus stays put so the user can retype immediately. Blurring here is
    // what made the old version feel like it ignored the tap.
    inputRef.current?.focus();
  };

  return (
    <Input
      ref={inputRef}
      icon={Search}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder ?? t('common.search')}
      autoCapitalize='none'
      autoCorrect={false}
      returnKeyType='search'
      autoFocus={autoFocus}
      rightComponent={
        value.length > 0 ? (
          <Pressable
            onPress={clear}
            hitSlop={12}
            accessibilityRole='button'
            accessibilityLabel={t('common.clear')}
            style={{ padding: 4 }}
          >
            <X size={16} />
          </Pressable>
        ) : undefined
      }
    />
  );
}