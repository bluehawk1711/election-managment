import { ThemedTabStack } from '@/components/nav/themed-tab-stack';
import { useTranslation } from 'react-i18next';

/**
 * Voter roll stack: the list, and the local-edit sheet (plan-voters.md
 * §6.1–6.3).
 *
 * There is no separate detail route any more. It sat between the list and the
 * form and made every edit two taps away, so everything it did — photo,
 * location, voted/leaning/support, call/WhatsApp, the roll read-only rows —
 * now lives on the edit screen, which the list pushes directly.
 */
export default function VotersLayout() {
  const { t } = useTranslation();

  return (
    <ThemedTabStack
      screens={[
        { name: 'index', title: t('voters.title') },
        { name: 'edit', title: t('voters.edit'), presentation: 'modal' },
      ]}
    />
  );
}
