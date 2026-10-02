import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { View } from '@/components/ui/view';
import { useColor } from '@/hooks/useColor';
import type { LucideProps } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import type { ComponentType } from 'react';

/**
 * Scaffold body for tabs whose screens arrive with the build phase (plan §4)
 * — present, navigable and titled, but not yet wired to its module's list.
 * The `common.empty` line keeps it honest without inventing copy that the
 * real screen will replace.
 */
export function PlaceholderScreen({
  title,
  icon,
}: {
  title: string;
  icon: ComponentType<LucideProps>;
}) {
  const { t } = useTranslation();
  const surface = useColor('surfaceContainerLow');
  const muted = useColor('textMuted');

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: 24,
        // Clear the floating tab bar (dock 12 + pill ~56 + breathing room).
        paddingBottom: 112,
      }}
    >
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: surface,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={26} color={muted} />
      </View>
      <Text variant='subtitle'>{title}</Text>
      <Text variant='caption' style={{ textAlign: 'center' }}>
        {t('common.empty')}
      </Text>
    </View>
  );
}
