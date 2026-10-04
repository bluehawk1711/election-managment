import { useColor } from '@/hooks/useColor';
import { Stack } from 'expo-router';

/**
 * Without this the group opens on whichever route sorts first —
 * `email-link` — because there is no `index.tsx` here. Every screen is a named
 * route on purpose, so that the password-recovery link can deep-link straight
 * to `/reset-password`.
 */
export const unstable_settings = {
  initialRouteName: 'sign-in',
};

export default function AuthLayout() {
  const text = useColor('text');
  const background = useColor('background');

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        headerTintColor: text,
        contentStyle: { backgroundColor: background },
        // Transitions are off app-wide (see `lib/anim-off.ts`): a slide-in on
        // every auth step made sign-in feel like it was waiting on something.
        animation: 'none',
      }}
    >
      <Stack.Screen name='sign-in' />
      <Stack.Screen name='sign-up' />
      {/* Firebase calls it email link sign-in; "magic link" is Supabase's word
          for the same thing. There is no `verify-otp` sibling because Firebase
          Authentication has no email OTP at all — see the README. */}
      <Stack.Screen name='email-link' />
      <Stack.Screen name='forgot-password' />
      <Stack.Screen name='reset-password' />
    </Stack>
  );
}
