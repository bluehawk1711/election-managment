import { FloatingTabBar } from '@/components/nav/floating-tab-bar';
import { useColor } from '@/hooks/useColor';
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';

/**
 * The tab shell (plan-voters.md §6): Home · Voters · Booths · Reports · More,
 * rendered by the custom floating bar rather than the platform default —
 * one frosted pill on every platform, matching `stich_ui`'s bottom nav.
 * Titles feed both the bar's labels and web accessibility via `nav.*`.
 *
 * Tasks and Calendar are no longer tabs: they live behind the More hub
 * (`(tabs)/more/tasks`, `(tabs)/more/calendar`) so the five slots go to the
 * roll, which is what this build is for.
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
      <Tabs.Screen name='voters' options={{ title: t('nav.voters') }} />
      <Tabs.Screen name='booths' options={{ title: t('nav.booths') }} />
      <Tabs.Screen name='reports' options={{ title: t('nav.reports') }} />
      <Tabs.Screen name='more' options={{ title: t('nav.more') }} />
    </Tabs>
  );
}
