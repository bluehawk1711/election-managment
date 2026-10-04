import { TabIndicator } from './tab-indicator';
import { TabItem } from './tab-item';
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
import { useEffect, useState, type ComponentType } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSharedValue } from 'react-native-reanimated';
import { withSpring } from '@/lib/anim-off';

/** Route name → lucide icon; labels arrive from each screen's `title`. */
const TAB_ICONS: Record<string, ComponentType<LucideProps>> = {
  '(home)': LayoutGrid,
  voters: Users,
  booths: Vote,
  reports: BarChart3,
  more: SlidersHorizontal,
};

/** Horizontal padding of the row; the cells (and the indicator) sit inside it. */
const ROW_PADDING = 4;

/**
 * The floating, frosted tab bar (plan §8) — the mock's fixed bottom nav:
 * a rounded pill inset 16px from the sides, 12px above the safe area, with a
 * fill that covers the active item.
 *
 * Rendered as an absolute overlay: it contributes zero height to the tab
 * navigator's column, so scenes run the full screen and scroll *under* the
 * pill. Screens own their own bottom padding.
 *
 * ## Why the indicator is arithmetic, not measured per item
 *
 * An earlier version had every item report its x/width from `onLayout` and
 * the indicator spring to the active item's frame. That was fragile in
 * exactly the ways a tab bar must not be: the label mounts and unmounts with
 * focus, so every tab switch reflowed all five items inside a
 * `space-between` row, five frame updates raced the indicator, and the fill
 * regularly settled at the wrong width — or stayed at zero when the active
 * frame never arrived.
 *
 * Now the cells are equal (`flex: 1` on every item, `munim`'s model): one
 * `onLayout` on the row itself, `cellWidth = rowWidth / count`, and the
 * indicator is `padding + index * cellWidth`. Label or no label, a cell's
 * bounds never change, so the fill's position and width are pure arithmetic —
 * there is nothing to race and nothing to go missing.
 *
 * ## Why the background is solid on Android
 *
 * `expo-blur` on Android is both expensive and stale-prone: the blur has to
 * re-render whenever the scene behind it changes — which is exactly what a
 * tab press does — and the docs call out that a BlurView rendered before
 * dynamic content simply stops updating. That combination made the bar
 * itself a per-frame cost during the most stutter-prone moment in the app.
 * iOS keeps the real blur; Android gets an opaque pill in the same colour,
 * which is what the 85% scrim already made it look like anyway.
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

  // The single measurement the indicator needs: the row's laid-out width.
  // Cells are equal, so active position/width follow from it by arithmetic.
  const [rowWidth, setRowWidth] = useState(0);
  const count = state.routes.length;

  const x = useSharedValue(0);
  const width = useSharedValue(0);
  useEffect(() => {
    const cell =
      count > 0 ? Math.max(0, (rowWidth - ROW_PADDING * 2) / count) : 0;
    x.value = withSpring(ROW_PADDING + state.index * cell, TAB_SPRING);
    width.value = withSpring(cell, TAB_SPRING);
  }, [rowWidth, state.index, count, x, width]);

  const onPress = (index: number) => {
    const route = state.routes[index];
    const focused = index === state.index;
    const event = navigation.emit({
      type: 'tabPress',
      target: route.key,
      canPreventDefault: true,
    });
    if (!focused && !event.defaultPrevented) {
      // Only on an actual tab change, so a re-tap of the open tab stays silent.
      Haptics.selectionAsync().catch(() => {});
      navigation.navigate(route.name, route.params);
    }
  };

  const content = (
    <View
      style={styles.row}
      onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)}
    >
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
            onPress={() => onPress(index)}
          />
        );
      })}
    </View>
  );

  return (
    <View
      pointerEvents='box-none'
      style={[styles.dock, { paddingBottom: 12 + insets.bottom }]}
    >
      {/* Shadow wrapper: RN clips `overflow: hidden` shadows, so the surface
          sits inside a separate rounded parent. */}
      <View style={styles.shadowWrap}>
        {Platform.OS === 'android' ? (
          // Solid pill — no blur on Android. See the note at the top.
          <View
            style={[
              styles.pill,
              { backgroundColor: withOpacity(pillColor, 0.96) },
            ]}
          >
            {content}
          </View>
        ) : (
          <BlurView
            intensity={scheme === 'dark' ? 45 : 70}
            tint={scheme ?? 'default'}
            style={styles.pill}
          >
            {/* 85% scrim over the blur — the mock's
                surface-container-lowest/85. */}
            <View
              pointerEvents='none'
              style={[
                styles.scrim,
                { backgroundColor: withOpacity(pillColor, 0.85) },
              ]}
            />
            {content}
          </BlurView>
        )}
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
    padding: ROW_PADDING,
  },
});
