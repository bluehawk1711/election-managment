import { Image } from '@/components/ui/image';
import { StyleSheet, View } from 'react-native';

/**
 * The app's logo mark (plan-voters.md §6.6).
 *
 * Sourced from `assets/images/logo.png` so there is exactly one logo file in
 * the repo. The same file backs the app icon, the splash screen and the web
 * favicon — see `app.json` — which is why this component takes a size rather
 * than baking one in: the same mark appears at 96pt on a sign-in screen and at
 * 24pt in a list header.
 *
 * `logo.png` is 1049×1008 — very slightly wider than tall. Rendered through
 * `resizeMode='contain'` so it letterboxes by about 0.4% rather than
 * stretching; at any size in this app that is invisible, and it keeps the
 * checkmark's stroke weight honest.
 *
 * TODO(variants): the platform-specific assets that Expo wants are not derived
 * from this file yet — `adaptiveIcon.foregroundImage` needs the mark inside
 * Android's 66%-safe-zone circle on a transparent background, and a monochrome
 * (white-on-transparent) variant is needed for themed icons on Android 13+ and
 * for iOS. `app.json` currently points every one of those at the same
 * full-bleed logo, which means the adaptive icon gets masked more aggressively
 * than intended and the monochrome icon has no chance of working. Deriving them
 * properly needs image tooling (sharp) plus a committed generation script, so
 * it is deliberately left as a marked gap rather than approximated.
 */
export function BrandLogo({
  size = 96,
  accessibilityLabel,
}: {
  size?: number;
  accessibilityLabel?: string;
}) {
  return (
    <View
      style={[styles.container, { width: size, height: size }]}
      // Decorative by default: next to a heading, the app name is already in
      // the text, and a VoiceOver user hearing "Election Campaign logo" before
      // "Welcome back" gains nothing.
      accessible={accessibilityLabel !== undefined}
      accessibilityRole={accessibilityLabel ? 'image' : undefined}
      accessibilityLabel={accessibilityLabel}
    >
      <Image
        source={require('@/assets/images/logo.png')}
        style={styles.image}
        // `variant='default'` is required, not cosmetic: `components/ui/image`
        // defaults to `variant='rounded'`, which applies `borderRadius` AND
        // `overflow: 'hidden'`. The logo is already a rounded square, so that
        // would clip its own corners a second time and shave the mark.
        variant='default'
        contentFit='contain'
        // No spinner, no error fallback: this is a bundled asset, so it is
        // present or the bundle is broken. A loading indicator that can never
        // resolve is worse than an instant paint.
        showLoadingIndicator={false}
        showErrorFallback={false}
        // The file is ~680 KB at 1049px. At the 96pt this renders, that is far
        // more resolution than the screen can show, and it is decoded at
        // startup on every cold launch — including the splash, which is the
        // first frame the user waits on.
        transition={0}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center' },
  // `flex: 1` inside the fixed-size container is what makes `contentFit`
  // actually have a box to fit into — without it the Image collapses to 0×0.
  image: { width: '100%', height: '100%' },
});