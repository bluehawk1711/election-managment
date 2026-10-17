import { Text } from '@/components/ui/text';
import { View } from '@/components/ui/view';
import { useKeyboardHeight } from '@/hooks/useKeyboardHeight'; // Make sure this path is correct
import { useColor } from '@/hooks/useColor';
import { BORDER_RADIUS } from '@/theme/globals';
import React, { useCallback, useEffect, useRef } from 'react';
import {
  Modal,
  ScrollView,
  TouchableWithoutFeedback,
  useWindowDimensions,
  ViewStyle,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
  type GestureType,
} from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Open / re-snap spring — near-critically damped so a 0.9 snap travels the
 * whole screen in ~300ms without a visible rebound at the end.
 *
 * Deliberately **not** imported from `lib/anim-off`. The app's
 * animations-switched-off policy exists for list-scroll frame budgets: an
 * overlay that *vanishes* on close is not "faster", it is broken — there is
 * no half-finished state to protect, only one view. The sheet therefore keeps
 * real motion, and this is the whole of its choreography:
 *
 * - open: this spring slides up, backdrop fades in over 200ms;
 * - close: an accelerating slide-down (`Easing.in(cubic)` — gravity, not a
 *   spring: a dismissed sheet must not bounce back up), backdrop fades out
 *   first so the scrim never outlives the sheet;
 * - the modal unmounts only when the *sheet* animation reports `finished`,
 *   so teardown can never cut the exit off mid-flight.
 */
const SNAP_SPRING = { damping: 32, stiffness: 300, mass: 1 } as const;

/** See SNAP_SPRING — the close choreography, in two halves. */
const CLOSE_SHEET = { duration: 240, easing: Easing.in(Easing.cubic) } as const;
const CLOSE_BACKDROP = {
  duration: 180,
  easing: Easing.out(Easing.quad),
} as const;
const OPEN_BACKDROP = { duration: 200 } as const;

type BottomSheetContentProps = {
  children: React.ReactNode;
  title?: string;
  style?: ViewStyle;
  rBottomSheetStyle: any;
  cardColor: string;
  mutedColor: string;
  screenHeight: number;
  /**
   * The sheet's own height, i.e. `screenHeight * largestSnapPoint`.
   *
   * The container used to be `height: screenHeight` while resting only
   * `snapPoint` up the screen — so at a 0.92 snap its bottom edge sat 8% of
   * the display *below* the screen, and the ScrollView inside it ended there
   * too. Scrolling to the end of the list therefore parked the last option
   * off-screen where no finger could reach it: exactly the "last ward item
   * isn't visible" report. Sizing the container to the visible region makes
   * the ScrollView's end coincide with the screen's, so the last row lands
   * above the bottom edge like every other row.
   */
  sheetHeight: number;
  onHandlePress?: () => void;
  /**
   * Drag gesture, applied to the handle + title header ONLY.
   *
   * It used to wrap the whole sheet — handle, title *and* the content
   * ScrollView — and a `Gesture.Pan` always wins over the native scroll
   * responder underneath it. Every vertical drag in the ward list therefore
   * moved the entire sheet a few pixels and sprang it back instead of
   * scrolling the list: the ward picker looked frozen with 14 options and no
   * way to reach ward 5. Restricting the pan to the header leaves the
   * ScrollView owning every touch that starts on the content, which is also
   * the interaction people expect from a sheet (drag the bar, scroll the
   * body).
   */
  gesture?: GestureType;
};

// Component for the bottom sheet content
// It now includes a ScrollView by default for better form handling.
const BottomSheetContent = ({
  children,
  title,
  style,
  rBottomSheetStyle,
  cardColor,
  mutedColor,
  screenHeight,
  sheetHeight,
  onHandlePress,
  gesture,
}: BottomSheetContentProps) => {
  const insets = useSafeAreaInsets();

  const header = (
    <>
      {/* Handle */}
      <TouchableWithoutFeedback onPress={onHandlePress}>
        <View
          style={{
            width: '100%',
            paddingVertical: 12,
            alignItems: 'center',
          }}
        >
          <View
            style={{
              width: 64,
              height: 6,
              backgroundColor: mutedColor,
              borderRadius: 999,
            }}
          />
        </View>
      </TouchableWithoutFeedback>

      {/* Title */}
      {title && (
        <View
          style={{
            marginHorizontal: 16,
            marginTop: 16,
            paddingBottom: 8,
          }}
        >
          <Text variant='title' style={{ textAlign: 'center' }}>
            {title}
          </Text>
        </View>
      )}
    </>
  );

  return (
    <Animated.View
      style={[
        {
          height: sheetHeight,
          width: '100%',
          position: 'absolute',
          top: screenHeight,
          backgroundColor: cardColor,
          borderTopLeftRadius: BORDER_RADIUS,
          borderTopRightRadius: BORDER_RADIUS,
        },
        rBottomSheetStyle,
        style,
      ]}
    >
      {/* Drag region = header only; see the `gesture` prop doc. A plain View
          when there is no gesture — GestureDetector needs one native child. */}
      {gesture ? (
        <GestureDetector gesture={gesture}>
          <View style={{ width: '100%' }}>{header}</View>
        </GestureDetector>
      ) : (
        header
      )}

      {/* Content now wrapped in a ScrollView */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          padding: 16,
          paddingBottom: Math.max(insets.bottom, 16),
        }}
        keyboardShouldPersistTaps='handled'
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </Animated.View>
  );
};

type BottomSheetProps = {
  isVisible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  snapPoints?: number[];
  enableBackdropDismiss?: boolean;
  title?: string;
  style?: ViewStyle;
  disablePanGesture?: boolean;
};

export function BottomSheet({
  isVisible,
  onClose,
  children,
  snapPoints = [0.3, 0.6, 0.9],
  enableBackdropDismiss = true,
  title,
  style,
  disablePanGesture = false,
}: BottomSheetProps) {
  const cardColor = useColor('card');
  const mutedColor = useColor('muted');
  const { keyboardHeight, isKeyboardVisible } = useKeyboardHeight();
  const { height: screenHeight } = useWindowDimensions();
  const maxTranslateY = -screenHeight + 50;

  const translateY = useSharedValue(0);
  const context = useSharedValue({ y: 0 });
  const opacity = useSharedValue(0);
  const currentSnapIndex = useSharedValue(0);
  // Shared value to hold keyboard height for use in worklets
  const keyboardHeightSV = useSharedValue(0);

  const snapPointsHeights = snapPoints.map((point) => -screenHeight * point);
  const defaultHeight = snapPointsHeights[0];
  /** Visible height at the tallest snap — see `sheetHeight` on the content. */
  const sheetHeight = screenHeight * Math.max(...snapPoints);

  const [modalVisible, setModalVisible] = React.useState(false);

  /**
   * Lifecycle flags, as refs rather than state: they are read from animation
   * callbacks on the UI thread (`runOnJS`) where a stale render closure would
   * otherwise decide whether to unmount.
   *
   * - `openedRef` — the sheet has been opened at least once, so the effect's
   *   close branch cannot animate (and schedule the unmount of) a modal that
   *   was never shown. Without it the very first render — `isVisible` false —
   *   would run a full close cycle on mount.
   * - `closingRef` — a close animation is in flight. `finishClose` honours it
   *   *and* re-checks `isVisibleRef`: reopening mid-close cancels the sheet
   *   animation (its callback then fires with `finished === false`, which is
   *   already a no-op), and the ref check covers the last frame between a
   *   reopen and that cancellation landing.
   * - `isVisibleRef` — the prop's latest value, read fresh in `finishClose`.
   */
  const openedRef = useRef(false);
  const closingRef = useRef(false);
  const isVisibleRef = useRef(isVisible);

  /**
   * The single unmount point: reached only from the sheet slide-down's
   * `finished === true` callback, i.e. only once the sheet has actually left
   * the screen. The backdrop fade is shorter by design (CLOSE_BACKDROP), so
   * the sheet animation is always the one holding the door.
   */
  const finishClose = useCallback(() => {
    if (!closingRef.current || isVisibleRef.current) return;
    closingRef.current = false;
    openedRef.current = false;
    setModalVisible(false);
  }, []);

  // Effect to handle opening and closing the bottom sheet
  useEffect(() => {
    isVisibleRef.current = isVisible;

    if (isVisible) {
      closingRef.current = false;
      openedRef.current = true;
      setModalVisible(true);
      translateY.value = withSpring(defaultHeight, SNAP_SPRING);
      opacity.value = withTiming(1, OPEN_BACKDROP);
      currentSnapIndex.value = 0;
    } else if (openedRef.current) {
      closingRef.current = true;
      translateY.value = withTiming(0, CLOSE_SHEET, (finished) => {
        if (finished) runOnJS(finishClose)();
      });
      opacity.value = withTiming(0, CLOSE_BACKDROP);
    }
  }, [isVisible, defaultHeight, finishClose]);

  /**
   * Every dismissal funnels through here — backdrop tap, Android hardware
   * back, drag-past-the-close-threshold — and all it does is ask the parent
   * to flip `isVisible`. The effect above owns the animation, so there is
   * exactly one close path instead of three that can disagree about whether
   * the sheet is on its way out. (`onClose` is wired to that flip by every
   * call site: `useBottomSheet().close` / `setOpen(false)`.)
   */
  const requestClose = useCallback(() => {
    onClose();
  }, [onClose]);

  // Function to animate the sheet to a specific destination
  const scrollTo = (destination: number) => {
    'worklet';
    translateY.value = withSpring(destination, SNAP_SPRING);
  };

  // --- START: NEW KEYBOARD HANDLING LOGIC ---
  useEffect(() => {
    // Update the shared value whenever keyboardHeight changes
    keyboardHeightSV.value = keyboardHeight;

    // Only adjust position if the sheet is currently visible
    if (isVisible) {
      const currentSnapHeight = snapPointsHeights[currentSnapIndex.value];
      let destination: number;

      if (isKeyboardVisible) {
        // Keyboard is open, move sheet up by keyboard height
        destination = currentSnapHeight - keyboardHeight;
      } else {
        // Keyboard is closed, return to original snap point
        destination = currentSnapHeight;
      }
      scrollTo(destination);
    }
  }, [keyboardHeight, isKeyboardVisible, isVisible]);
  // --- END: NEW KEYBOARD HANDLING LOGIC ---

  const findClosestSnapPoint = (currentY: number) => {
    'worklet';
    // Adjust the currentY by the keyboard height to find the original snap point
    const adjustedY = currentY + keyboardHeightSV.value;

    let closest = snapPointsHeights[0];
    let minDistance = Math.abs(adjustedY - closest);
    let closestIndex = 0;

    for (let i = 0; i < snapPointsHeights.length; i++) {
      const snapPoint = snapPointsHeights[i];
      const distance = Math.abs(adjustedY - snapPoint);
      if (distance < minDistance) {
        minDistance = distance;
        closest = snapPoint;
        closestIndex = i;
      }
    }
    currentSnapIndex.value = closestIndex;
    return closest;
  };

  const handlePress = () => {
    const nextIndex = (currentSnapIndex.value + 1) % snapPointsHeights.length;
    currentSnapIndex.value = nextIndex;
    const destination = snapPointsHeights[nextIndex] - keyboardHeightSV.value;
    scrollTo(destination);
  };

  const gesture = Gesture.Pan()
    .onStart(() => {
      context.value = { y: translateY.value };
    })
    .onUpdate((event) => {
      const newY = context.value.y + event.translationY;
      if (newY <= 0 && newY >= maxTranslateY) {
        translateY.value = newY;
      }
    })
    .onEnd((event) => {
      const currentY = translateY.value;
      const velocity = event.velocityY;

      // Close on a downward drag *relative to the sheet's own snap point*.
      // The old check compared against `-screenHeight * 0.2`, i.e. it only
      // fired when the sheet was already near the top of the screen — from a
      // 0.92 snap you had to drag down 72% of the display to close, so the
      // handle felt broken. 15% of the screen below where the sheet sits is
      // the gesture people actually make.
      const snapY =
        snapPointsHeights[currentSnapIndex.value] - keyboardHeightSV.value;
      if (
        currentY - snapY > screenHeight * 0.15 ||
        (velocity > 500 && currentY > snapY + screenHeight * 0.05)
      ) {
        // Handed back to the JS thread so the close runs through the one
        // funnel (`requestClose`) — the worklet only decides *that* it is a
        // dismiss, the effect performs it.
        runOnJS(requestClose)();
        return;
      }

      // Find the closest original snap point
      const closestSnapPoint = findClosestSnapPoint(currentY);
      // Calculate the final destination, accounting for the keyboard height
      const finalDestination = closestSnapPoint - keyboardHeightSV.value;
      scrollTo(finalDestination);
    });

  const rBottomSheetStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateY: translateY.value }],
    };
  });

  const rBackdropStyle = useAnimatedStyle(() => {
    return {
      opacity: opacity.value,
    };
  });

  const handleBackdropPress = () => {
    if (enableBackdropDismiss) {
      requestClose();
    }
  };

  return (
    <Modal
      visible={modalVisible}
      transparent
      statusBarTranslucent
      animationType='none'
      // Android: dismiss the sheet rather than letting the press fall
      // through to the app behind it. Gated exactly like a backdrop tap.
      onRequestClose={() => {
        if (enableBackdropDismiss) requestClose();
      }}
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Animated.View
          style={[
            { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.8)' },
            rBackdropStyle,
          ]}
          accessibilityViewIsModal
        >
          <TouchableWithoutFeedback onPress={handleBackdropPress}>
            <Animated.View style={{ flex: 1 }} />
          </TouchableWithoutFeedback>

          <BottomSheetContent
            children={children}
            title={title}
            style={style}
            rBottomSheetStyle={rBottomSheetStyle}
            cardColor={cardColor}
            mutedColor={mutedColor}
            screenHeight={screenHeight}
            sheetHeight={sheetHeight}
            onHandlePress={() => runOnJS(handlePress)()}
            gesture={disablePanGesture ? undefined : gesture}
          />
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

// Hook for managing bottom sheet state
export function useBottomSheet() {
  const [isVisible, setIsVisible] = React.useState(false);

  const open = React.useCallback(() => {
    setIsVisible(true);
  }, []);

  const close = React.useCallback(() => {
    setIsVisible(false);
  }, []);

  const toggle = React.useCallback(() => {
    setIsVisible((prev) => !prev);
  }, []);

  return {
    isVisible,
    open,
    close,
    toggle,
  };
}