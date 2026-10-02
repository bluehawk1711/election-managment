import { Input } from '@/components/ui/input';
import { Search, X } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable } from 'react-native';

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
};

/** Search field with leading icon and a one-tap clear affordance. */
export function SearchInput({ value, onChangeText, placeholder, autoFocus }: Props) {
  const { t } = useTranslation();

  return (
    <Input
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
          <Pressable onPress={() => onChangeText('')} hitSlop={10} accessibilityLabel={t('common.clear')}>
            <X size={16} />
          </Pressable>
        ) : undefined
      }
    />
  );
}
