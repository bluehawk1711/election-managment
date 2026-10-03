import { BrandLogo } from '@/components/brand/brand-logo';
import { AvoidKeyboard } from '@/components/ui/avoid-keyboard';
import { ScrollView } from '@/components/ui/scroll-view';
import { Text } from '@/components/ui/text';
import { View } from '@/components/ui/view';
import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';

/**
 * The frame every screen under `(auth)` shares: logo, title, subtitle, and a
 * body that stays above the keyboard.
 *
 * `AvoidKeyboard` is a trailing spacer, not a wrapper — it renders an animated
 * view that grows to the keyboard's height. It has to sit after the scroll
 * view, as a sibling, which is why it is outside the `ScrollView` below.
 *
 * The logo is here rather than in each screen because all five screens under
 * `(auth)` are the same product at different steps; a mark that appears on
 * sign-in and not on sign-up reads as two different apps.
 *
 * `logo={false}` opts a screen out, for the ones that are mid-flow and should
 * not look like a fresh entry point — the email-link and reset-password screens
 * are reached from a link, and the user is already past the front door.
 */
export function AuthScreen({
  title,
  subtitle,
  children,
  footer,
  logo = true,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** `false` on screens reached from a deep link, mid-flow. */
  logo?: boolean;
}) {
  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          flexGrow: 1,
          padding: 24,
          gap: 24,
          justifyContent: 'center',
        }}
        keyboardShouldPersistTaps='handled'
      >
        {/* Centred in its own row rather than by the scroll container: the
            container has to stay `alignItems: 'stretch'` so the inputs below it
            fill the width, and `BrandLogo` is a fixed 96pt box, so left to the
            parent it hugs the start edge. */}
        {logo ? (
          <View style={styles.logoRow}>
            <BrandLogo size={96} />
          </View>
        ) : null}

        <View style={{ gap: 8 }}>
          <Text variant='heading'>{title}</Text>
          {subtitle && <Text variant='caption'>{subtitle}</Text>}
        </View>

        <View style={{ gap: 16 }}>{children}</View>

        {footer && <View style={{ gap: 12, marginTop: 8 }}>{footer}</View>}
      </ScrollView>

      <AvoidKeyboard />
    </View>
  );
}

const styles = StyleSheet.create({
  logoRow: { alignItems: 'center' },
});
