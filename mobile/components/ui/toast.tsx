import { Text } from '@/components/ui/text';
import { AlertCircle, Check, Info, X } from 'lucide-react-native';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  AccessibilityInfo,
  Dimensions,
  Platform,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { withDelay, withSpring, withTiming } from '@/lib/anim-off';

export type ToastVariant = 'default' | 'success' | 'error' | 'warning' | 'info';

export interface ToastData {
  id: string;
  title?: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
  action?: {
    label: string;
    onPress: () => void;
  };
}

interface ToastProps extends ToastData {
  onDismiss: (id: string) => void;
  index: number;
}

const { width: screenWidth } = Dimensions.get('window');
const DYNAMIC_ISLAND_HEIGHT = 37;
const EXPANDED_HEIGHT = 85;
const TOAST_MARGIN = 8;
const DYNAMIC_ISLAND_WIDTH = 126;
const EXPANDED_WIDTH = screenWidth - 32;

// Motion constants.
//
// These were springs (`stiffness: 120, damping: 8`). A damping ratio that low is
// very underdamped — the toast visibly overshot its resting position, bounced
// past 1.0 on the way in, and wobbled again on the way out. On a notification
// that appears over whatever the user was doing, that reads as a glitch rather
// than as polish, and it is worse on a budget Android phone where the spring has
// to be re-evaluated per frame.
//
// A short eased timing curve is the right shape here: a toast is a state change,
// not a physical object, so it should move decisively and stop. Swipe-to-dismiss
// still tracks the finger 1:1 — that part was never animated and is unchanged.
const ENTER_DURATION = 220;
const EXIT_DURATION = 160;
const EASE_OUT = Easing.out(Easing.cubic);
const EASE_IN = Easing.in(Easing.cubic);

/** Scale the toast starts at. 0.8 was a big enough jump to read as a pop. */
const ENTER_SCALE = 0.94;
const EXIT_SCALE = 0.96;

export function Toast({
  id,
  title,
  description,
  variant = 'default',
  onDismiss,
  index,
  action,
}: ToastProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion
    );
    return () => subscription.remove();
  }, []);

  // Reanimated shared values
  const translateY = useSharedValue(-100);
  const translateX = useSharedValue(0);
  const opacity = useSharedValue(0);
  const scale = useSharedValue(ENTER_SCALE);
  const width = useSharedValue(DYNAMIC_ISLAND_WIDTH);
  const height = useSharedValue(DYNAMIC_ISLAND_HEIGHT);
  const borderRadius = useSharedValue(18.5);
  const contentOpacity = useSharedValue(0);

  // Dynamic Island colors (dark theme optimized)
  const backgroundColor = '#1C1C1E'; // iOS Dynamic Island background
  const mutedTextColor = '#8E8E93'; // iOS secondary text color

  useEffect(() => {
    const hasContentToShow = Boolean(title || description || action);

    if (hasContentToShow) {
      // If there's content, start directly with expanded state
      width.value = EXPANDED_WIDTH;
      height.value = EXPANDED_HEIGHT;
      borderRadius.value = 20;
      setIsExpanded(true);

      if (reduceMotion) {
        translateY.value = 0;
        opacity.value = 1;
        scale.value = 1;
        contentOpacity.value = 1;
      } else {
        // Animate in expanded toast
        translateY.value = withTiming(0, { duration: ENTER_DURATION, easing: EASE_OUT });
        opacity.value = withTiming(1, { duration: ENTER_DURATION, easing: EASE_OUT });
        scale.value = withTiming(1, { duration: ENTER_DURATION, easing: EASE_OUT });
        // The text trails the container slightly so the card is already in
        // place by the time the words appear, which reads as one movement
        // rather than two.
        contentOpacity.value = withDelay(
          80,
          withTiming(1, { duration: ENTER_DURATION, easing: EASE_OUT })
        );
      }
    } else {
      // If no content, show compact Dynamic Island with icon only
      setIsExpanded(false);

      if (reduceMotion) {
        translateY.value = 0;
        opacity.value = 1;
        scale.value = 1;
      } else {
        // Animate in compact toast
        translateY.value = withTiming(0, { duration: ENTER_DURATION, easing: EASE_OUT });
        opacity.value = withTiming(1, { duration: ENTER_DURATION, easing: EASE_OUT });
        scale.value = withTiming(1, { duration: ENTER_DURATION, easing: EASE_OUT });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]); // Re-run if the reduced-motion setting resolves after mount

  const getVariantColor = () => {
    switch (variant) {
      case 'success':
        return '#30D158'; // iOS green
      case 'error':
        return '#FF453A'; // iOS red
      case 'warning':
        return '#FF9F0A'; // iOS orange
      case 'info':
        return '#007AFF'; // iOS blue
      default:
        return '#8E8E93'; // iOS gray
    }
  };

  const getIcon = () => {
    const iconProps = { size: 16, color: getVariantColor() };

    switch (variant) {
      case 'success':
        return <Check {...iconProps} />;
      case 'error':
        return <X {...iconProps} />;
      case 'warning':
        return <AlertCircle {...iconProps} />;
      case 'info':
        return <Info {...iconProps} />;
      default:
        return null;
    }
  };

  const dismiss = useCallback(() => {
    if (reduceMotion) {
      onDismiss(id);
      return;
    }

    // This function will be called from the UI thread
    const onDismissAction = () => {
      'worklet';
      runOnJS(onDismiss)(id);
    };

    translateY.value = withTiming(-100, { duration: EXIT_DURATION, easing: EASE_IN });
    opacity.value = withTiming(0, { duration: EXIT_DURATION, easing: EASE_IN }, (finished) => {
      if (finished) {
        onDismissAction();
      }
    });
    scale.value = withTiming(EXIT_SCALE, { duration: EXIT_DURATION, easing: EASE_IN });
  }, [id, onDismiss, reduceMotion]);

  const panGesture = Gesture.Pan()
    .onUpdate((event) => {
      // Reduced motion: swipe-to-dismiss still works (below), it just
      // doesn't visually track the finger.
      if (reduceMotion) return;
      translateX.value = event.translationX;
    })
    .onEnd((event) => {
      const { translationX, velocityX } = event;

      if (
        Math.abs(translationX) > screenWidth * 0.25 ||
        Math.abs(velocityX) > 800
      ) {
        if (reduceMotion) {
          runOnJS(onDismiss)(id);
          return;
        }

        // Dismiss action to be called from the UI thread
        const onDismissAction = () => {
          'worklet';
          runOnJS(onDismiss)(id);
        };

        // Animate out horizontally
        translateX.value = withTiming(
          translationX > 0 ? screenWidth : -screenWidth,
          { duration: EXIT_DURATION, easing: EASE_IN }
        );
        opacity.value = withTiming(0, { duration: EXIT_DURATION, easing: EASE_IN }, (finished) => {
          if (finished) {
            onDismissAction();
          }
        });
      } else if (!reduceMotion) {
        // Snap back. Still a spring rather than a timing, because this one
        // *is* tracking a finger and the overshoot is the gesture feeling
        // physical — but critically damped, so it settles immediately.
        translateX.value = withSpring(0, { damping: 26, stiffness: 320 });
      }
    });

  const getTopPosition = () => {
    const statusBarHeight = Platform.OS === 'ios' ? 59 : 20;
    return statusBarHeight + index * (EXPANDED_HEIGHT + TOAST_MARGIN);
  };

  // Animated styles
  const animatedContainerStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateY: translateY.value },
      { translateX: translateX.value },
      { scale: scale.value },
    ],
  }));

  const animatedIslandStyle = useAnimatedStyle(() => ({
    width: width.value,
    height: height.value,
    borderRadius: borderRadius.value,
    backgroundColor,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  }));

  const animatedContentStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
  }));

  const toastStyle: ViewStyle = {
    position: 'absolute',
    top: getTopPosition(),
    alignSelf: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
    zIndex: 1000 + index,
  };

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View
        style={[toastStyle, animatedContainerStyle]}
        accessible
        accessibilityRole='alert'
        accessibilityLiveRegion='polite'
        accessibilityLabel={[title, description].filter(Boolean).join('. ')}
      >
        <Animated.View style={animatedIslandStyle}>
          {/* Compact state - just icon or indicator */}
          {!isExpanded && (
            <View style={{ justifyContent: 'center', alignItems: 'center' }}>
              {getIcon()}
            </View>
          )}

          {/* Expanded state - full content */}
          {isExpanded && (
            <Animated.View
              style={[
                {
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  flexDirection: 'row',
                  alignItems: 'center',
                },
                animatedContentStyle,
              ]}
            >
              {getIcon() && (
                <View style={{ marginRight: 12 }}>{getIcon()}</View>
              )}

              <View style={{ flex: 1, minWidth: 0 }}>
                {title && (
                  <Text
                    variant='subtitle'
                    style={{
                      color: '#FFFFFF',
                      fontSize: 15,
                      fontWeight: '600',
                      marginBottom: description ? 2 : 0,
                    }}
                    numberOfLines={1}
                    ellipsizeMode='tail'
                  >
                    {title}
                  </Text>
                )}
                {description && (
                  <Text
                    variant='caption'
                    style={{
                      color: mutedTextColor,
                      fontSize: 13,
                      fontWeight: '400',
                    }}
                    numberOfLines={2}
                    ellipsizeMode='tail'
                  >
                    {description}
                  </Text>
                )}
              </View>

              {action && (
                <TouchableOpacity
                  onPress={action.onPress}
                  style={{
                    marginLeft: 12,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    backgroundColor: getVariantColor(),
                    borderRadius: 12,
                  }}
                >
                  <Text
                    variant='caption'
                    style={{
                      color: '#FFFFFF',
                      fontSize: 12,
                      fontWeight: '600',
                    }}
                  >
                    {action.label}
                  </Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                onPress={dismiss}
                style={{ marginLeft: 8, padding: 4, borderRadius: 8 }}
              >
                <X size={14} color={mutedTextColor} />
              </TouchableOpacity>
            </Animated.View>
          )}
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

interface ToastContextType {
  toast: (toast: Omit<ToastData, 'id'>) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
  dismiss: (id: string) => void;
  dismissAll: () => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

interface ToastProviderProps {
  children: React.ReactNode;
  maxToasts?: number;
}

export function ToastProvider({ children, maxToasts = 3 }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const generateId = () => Math.random().toString(36).substr(2, 9);

  // Declared *before* `addToast`, which depends on it.
  //
  // It used to sit below, and `addToast`'s auto-dismiss timer called it
  // anyway — a temporal-dead-zone reference that only works because the call
  // happens later. Beyond being fragile, it made the memoisation
  // unpreservable: the React Compiler saw a closure over a binding declared
  // after its own definition and skipped the component ("Existing memoization
  // could not be preserved"), so the provider ran unoptimised.
  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    setToasts([]);
  }, []);

  const addToast = useCallback(
    (toastData: Omit<ToastData, 'id'>) => {
      const id = generateId();

      // Never enqueue a toast with nothing to say.
      //
      // `Toast` decides between its expanded layout and a bare icon pill on
      // `Boolean(title || description || action)`, so a call whose title
      // resolved to an empty string produced a coloured dot in the corner that
      // explained nothing and then vanished — the "empty toast". `t()` returns
      // `''` for a key that is missing from the *active* bundle even when it
      // exists in the type, which is exactly the shape of bug this guards.
      const title = toastData.title?.trim();
      const description = toastData.description?.trim();
      if (!title && !description && !toastData.action) {
        if (__DEV__) {
          console.warn(
            '[toast] dropped a toast with no title, description or action',
            toastData
          );
        }
        return;
      }

      const newToast: ToastData = {
        ...toastData,
        title: title || undefined,
        description: description || undefined,
        id,
        duration: toastData.duration ?? 4000,
      };

      setToasts((prev) => {
        const updated = [newToast, ...prev];
        return updated.slice(0, maxToasts);
      });

      // Auto dismiss after duration
      if (newToast.duration && newToast.duration > 0) {
        setTimeout(() => {
          dismissToast(id);
        }, newToast.duration);
      }
    },
    [maxToasts, dismissToast]
  );

  const createVariantToast = useCallback(
    (variant: ToastVariant, title: string, description?: string) => {
      addToast({
        title,
        description,
        variant,
      });
    },
    [addToast]
  );// Memoised, and that is not a micro-optimisation.
//
// `useToast()` returns this object, and consumers routinely put it in a
// `useCallback` dependency list. As a bare object literal it is a NEW reference
// on every render of the provider, so every one of those callbacks is
// invalidated on every render of the provider — the memoisation silently does
// nothing. The React Compiler sees a dependency that changes underneath it and
// refuses to compile the component at all ("Compilation Skipped: Existing
// memoization could not be preserved"), which is a real perf loss on top of the
// broken memo.
//
// The value itself only changes when `addToast`/`createVariantToast` do, and
// those are already `useCallback`-wrapped, so this memo is stable in practice.
const contextValue: ToastContextType = useMemo(
  () => ({
    toast: addToast,
    success: (title: string, description?: string) =>
      createVariantToast('success', title, description),
    error: (title: string, description?: string) =>
      createVariantToast('error', title, description),
    warning: (title: string, description?: string) =>
      createVariantToast('warning', title, description),
    info: (title: string, description?: string) =>
      createVariantToast('info', title, description),
    dismiss: dismissToast,
    dismissAll,
  }),
  [addToast, createVariantToast, dismissToast, dismissAll]
);

  const containerStyle: ViewStyle = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    pointerEvents: 'box-none',
  };

  return (
    <ToastContext.Provider value={contextValue}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        {children}
        <View style={containerStyle} pointerEvents='box-none'>
          {toasts.map((toast, index) => (
            <Toast
              key={toast.id}
              {...toast}
              index={index}
              onDismiss={dismissToast}
            />
          ))}
        </View>
      </GestureHandlerRootView>
    </ToastContext.Provider>
  );
}

// Hook to use toast
export function useToast() {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }

  return context;
}
