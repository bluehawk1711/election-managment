import { TabIndicator } from './tab-indicator';
import { TabItem, type TabFrame } from './tab-item';
import { View } from '@/components/ui/view';
import { useColor } from '@/hooks/useColor';
import { useColorScheme } from '@/hooks/useColorScheme';
import { TAB_SPRING } from '@/lib/animation';
import { withOpacity } from '@/theme/colors';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs';
import {
  BarChart3,
  LayoutGrid,
  SlidersHorizontal,
  Users,
  Vote,
  type LucideProps,
} from 'lucide-react-native';
import { useCallback, useEffect, useState, type ComponentType } from 'react';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSharedValue } from 'react-native-reanimated';
import { withSpring } from '@/lib/anim-off';

/**
 * Route name → lucide icon; labels arrive from each screen's `title`.
 *
 * Keyed by the exact route names registered in `(tabs)/_layout.tsx`. This list
 * used to carry `tasks` and `calendar`, which stopped being tabs when the roll
 * got the bar — so `voters` and `reports` were both missing and silently fell
 * through to the `LayoutGrid` fallback, leaving Home and Reports showing the
 * same icon. If a tab is added, add it here too; a missing entry is invisible
 * until two tabs share a glyph.
 */
const TAB_ICONS: Record<string, ComponentType<LucideProps>> = {
  '(home)': LayoutGrid,
  voters: Users,
  booths: Vote,
  reports: BarChart3,
  more: SlidersHorizontal,
};

/**
 * The floating, frosted tab bar (plan §8) — the mock's fixed bottom nav:
 * a blurred pill inset 16px from the sides, 12px above the safe area, with a
 * spring-driven fill gliding behind the active item.
 *
 * Rendered as an absolute overlay: it contributes zero height to the tab
 * navigator's column, so scenes run the full screen and scroll *under* the
 * pill (the mock's behaviour). Screens own their own bottom padding.
 *
 * Measurement lives here rather than in the items because the indicator has
 * to compare frames across items: every item reports its x/width from
 * `onLayout`, the active item's frame is springed into two shared values,
 * and `TabIndicator` reads them. When the active label mounts and the row
 * reflows, the new frame simply retargets the in-flight spring — the pill
 * converges on wherever the content settled.
 */
export function FloatingTabBar({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();

  const pillColor = useColor('surfaceContainerLowest');
  const primary = useColor('primary');
  const inactiveFg = useColor('mutedForeground');
  // A 12%-primary tint rather than the full `primaryContainer` fill. The
  // container colour is a solid block at pill size and dominated the bar; this
  // reads as a highlight while leaving the icon and label clearly on top of it.
  const activeBg = withOpacity(primary, 0.12);
  const activeFg = primary;

  const [frames, setFrames] = useState<Record<string, TabFrame>>({});
  const activeKey = state.routes[state.index].key;
  const activeFrame = frames[activeKey];

  const x = useSharedValue(0);
  const width = useSharedValue(0);
  useEffect(() => {
    x.value = withSpring(activeFrame?.x ?? 0, TAB_SPRING);
    width.value = withSpring(activeFrame?.width ?? 0, TAB_SPRING);
  }, [activeFrame?.x, activeFrame?.width, x, width]);

  const onFrame = useCallback((key: string, frame: TabFrame) => {
    setFrames((prev) => {
      const current = prev[key];
      if (
        current &&
        current.x === frame.x &&
        current.width === frame.width
      ) {
        return prev;
      }
      return { ...prev, [key]: frame };
    });
  }, []);

  const onPress = (index: number) => {
    Haptics.selectionAsync().catch(() => {});
    const route = state.routes[index];
    const focused = index === state.index;
    const event = navigation.emit({
      type: 'tabPress',
      target: route.key,
      canPreventDefault: true,
    });
    if (!focused && !event.defaultPrevented) {
      navigation.navigate(route.name, route.params);
    }
  };

  return (
    <View
      pointerEvents='box-none'
      style={[styles.dock, { paddingBottom: 12 + insets.bottom }]}
    >
      {/* Shadow wrapper: RN clips `overflow: hidden` shadows, so the blur
          layer sits inside a separate rounded parent. */}
      <View style={styles.shadowWrap}>
        <BlurView
          intensity={scheme === 'dark' ? 45 : 70}
          tint={scheme}
          style={styles.pill}
        >
          {/* 85% scrim over the blur — the mock's surface-container-lowest/85;
              on Android (no real blur) this alone reads as a solid pill. */}
          <View
            pointerEvents='none'
            style={[
              styles.scrim,
              { backgroundColor: withOpacity(pillColor, 0.85) },
            ]}
          />
          <View style={styles.row}>
            <TabIndicator x={x} width={width} color={activeBg} />
            {state.routes.map((route, index) => {
              const { options } = descriptors[route.key];
              const raw = options.tabBarLabel ?? options.title ?? route.name;
              const label = typeof raw === 'function' ? route.name : raw;
              const TabIcon = TAB_ICONS[route.name];

              return (
                <TabItem
                  key={route.key}
                  label={label}
                  icon={TabIcon ?? LayoutGrid}
                  focused={index === state.index}
                  color={activeFg}
                  inactiveColor={inactiveFg}
                  onFrame={(frame) => onFrame(route.key, frame)}
                  onPress={() => onPress(index)}
                />
              );
            })}
          </View>
        </BlurView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  shadowWrap: {
    width: '100%',
    maxWidth: 420,
    // mock: 0 8px 30px rgba(15, 18, 34, 0.08)
    borderRadius: 999,
    shadowColor: '#0F1222',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 30,
    elevation: 8,
  },
  pill: {
    borderRadius: 999,
    overflow: 'hidden',
  },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  row: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 4,
  },
});
