import { FloatingTabBar } from '@/components/nav/floating-tab-bar';
import { useColor } from '@/hooks/useColor';
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';

/**
 * The Core-7 tab shell (plan §7): Home · Booths · Tasks · Calendar · More,
 * rendered by the custom floating bar rather than the platform default —
 * one frosted pill on every platform, matching `stich_ui`'s bottom nav.
 * Titles feed both the bar's labels and web accessibility via `nav.*`.
 */
export default function TabsLayout() {
  const { t } = useTranslation();
  const background = useColor('background');

  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: background },
      }}
    >
      <Tabs.Screen name='(home)' options={{ title: t('nav.home') }} />
      <Tabs.Screen name='booths' options={{ title: t('nav.booths') }} />
      <Tabs.Screen name='tasks' options={{ title: t('nav.tasks') }} />
      <Tabs.Screen name='calendar' options={{ title: t('nav.calendar') }} />
      <Tabs.Screen name='more' options={{ title: t('nav.more') }} />
    </Tabs>
  );
}
