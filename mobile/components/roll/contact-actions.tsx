/**
 * Call / WhatsApp / Message — three services, three identities.
 *
 * The old row was three identical outline `Button`s, which read as nothing:
 * a call is not a message is not a WhatsApp, and the eye finds them by
 * colour. Each button now wears *its own* design:
 *
 * - **Call** — dial green (the `success` token, so dark mode keeps it
 *   correct), phone glyph, white label.
 * - **WhatsApp** — the brand green `#25D366`, the official WhatsApp glyph
 *   (`MaterialCommunityIcons`, the one brand mark this build actually ships —
 *   lucide has no brand icons) on white-dot green, white label. A brand
 *   colour, deliberately hardcoded rather than mapped to a theme token:
 *   WhatsApp green does not change with our dark mode any more than the logo
 *   does. It is the one button that does NOT act on press: it opens the
 *   compose sheet first, so the message that goes out is one the sender
 *   wrote (there is no standing campaign text any more — see
 *   `whatsapp-compose.tsx` and `lib/contact.ts::whatsappUrl`).
 * - **Message** — SMS blue (the `info` token), message glyph, white label.
 *
 * Two shapes from one component: the full trio (`compact={false}`) acts on
 * one "active" number; `compact` renders three icon-only discs for a proposal
 * row, so every *team-proposed* number on the voter is directly dialable —
 * which is the whole point of showing them side by side.
 *
 * All three shell out through `lib/contact.ts`, whose `openExternal` opens
 * with `Linking.openURL` directly — on Android 11+ a `canOpenURL` pre-check
 * would return false for `tel:`/`sms:` unless the manifest declared them in
 * `<queries>`, which is exactly how these buttons looked dead on real devices.
 */
import { Text } from '@/components/ui/text';
import { useColor } from '@/hooks/useColor';
import { useHaptics } from '@/hooks/useHaptics';
import { WhatsAppCompose } from '@/components/roll/whatsapp-compose';
import { openExternal, smsUrl, telUrl } from '@/lib/contact';
import { isValidPhone, phoneKey } from '@/lib/roll/contacts';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { MessageSquare, Phone } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

/** WhatsApp brand green — a brand constant, not a theme token. */
const WHATSAPP_GREEN = '#25D366';

interface Props {
  /** The number to act on. Empty/invalid renders everything disabled. */
  phone?: string | null;
  /** Icon-only discs instead of the full labelled trio. */
  compact?: boolean;
  /** Called when a tap could not open anything (no number / no app). */
  onFail?: () => void;
}

export function ContactActions({ phone, compact = false, onFail }: Props) {
  const { t } = useTranslation();
  const success = useColor('success');
  const info = useColor('info');
  const feedback = useHaptics();

  // Raw first, normalized second — see `isValidPhone`: stripping before
  // validating would let a typo'd input dial the digits it happens to leave
  // behind rather than reporting it as unusable.
  const raw = (phone ?? '').trim();
  const enabled = isValidPhone(raw);
  const number = enabled ? phoneKey(raw) : '';

  /**
   * The compose sheet's draft, kept across opens on this card so a second
   * message to the next house does not mean retyping the first one. State on
   * the component rather than in a store: the draft belongs to the voter
   * being looked at, which is exactly what a component instance is.
   *
   * Starts EMPTY — there is no default campaign message any more (see
   * `lib/contact.ts::whatsappUrl`), so nothing a user did not type can go
   * out under their name.
   */
  const [message, setMessage] = useState('');
  const [composing, setComposing] = useState(false);

  const open = (url: string | null) => {
    if (!enabled || !url) {
      onFail?.();
      return;
    }
    feedback('impact-light');
    void openExternal(url)
      .then((ok) => {
        if (!ok) onFail?.();
      })
      .catch(() => onFail?.());
  };

  const press = (key: string, url: string | null) => {
    if (!enabled) {
      onFail?.();
      return;
    }
    // WhatsApp never opens directly any more — the message has to be
    // something the sender wrote, so the sheet comes first every time.
    if (key === 'whatsapp') {
      feedback('impact-light');
      setComposing(true);
      return;
    }
    open(url);
  };

  const compose = (
    <WhatsAppCompose
      visible={composing}
      phone={number}
      message={message}
      onMessageChange={setMessage}
      onClose={() => setComposing(false)}
      onFail={onFail}
    />
  );

  const buttons = [
    { key: 'call', icon: <Phone size={16} color='#fff' strokeWidth={2.4} />, label: t('voters.call'), bg: success, url: telUrl(number) },
    {
      key: 'whatsapp',
      icon: <MaterialCommunityIcons name='whatsapp' size={17} color='#fff' />,
      label: t('voters.whatsapp'),
      bg: WHATSAPP_GREEN,
      url: null as string | null,
    },
    {
      key: 'message',
      icon: <MessageSquare size={16} color='#fff' strokeWidth={2.4} />,
      label: t('voters.message'),
      bg: info,
      url: smsUrl(number),
    },
  ] as const;

  if (compact) {
    return (
      <View style={styles.row}>
        {compose}
        {buttons.map((button) => (
          <Pressable
            key={button.key}
            onPress={() => press(button.key, button.url)}
            disabled={!enabled}
            accessibilityRole='button'
            accessibilityLabel={button.label}
            accessibilityState={{ disabled: !enabled }}
            style={({ pressed }) => [
              styles.disc,
              { backgroundColor: button.bg },
              !enabled && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            {button.icon}
          </Pressable>
        ))}
      </View>
    );
  }

  return (
    <View style={styles.row}>
      {compose}
      {buttons.map((button) => (
        <Pressable
          key={button.key}
          onPress={() => press(button.key, button.url)}
          disabled={!enabled}
          accessibilityRole='button'
          accessibilityLabel={button.label}
          accessibilityState={{ disabled: !enabled }}
          style={({ pressed }) => [
            styles.pill,
            { backgroundColor: button.bg },
            !enabled && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          {button.icon}
          <Text style={styles.label}>{button.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  pill: {
    flex: 1,
    height: 50,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  /** Compact discs for proposal rows — 40pt tap target with a 4pt slop-free gap. */
  disc: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    color: '#fff',
    fontSize: 13.5,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.88,
    transform: [{ scale: 0.97 }],
  },
});