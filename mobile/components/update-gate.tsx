/**
 * The update lock — a full-screen modal that replaces the ENTIRE app when
 * this build's version is below `appConfig/general.requiredVersion`.
 *
 * Behavior, chosen to fail in the safe direction everywhere:
 *
 *  - while the config is being read, the app renders normally (a slow fetch
 *    must not become a spinner nobody can dismiss);
 *  - an unreachable / missing / malformed config renders normally too — the
 *    fail-open contract of `lib/app-config.ts`;
 *  - a build BELOW the floor renders only this screen: no sign-in, no tabs,
 *    nothing. The lock is informational, not a security boundary (the rules
 *    still reject whatever an old client cannot speak), which is exactly why
 *    the modal can exist before auth state is known.
 *
 * "Update" opens WhatsApp at the configured support number through the
 * compose sheet — EMPTY, because nothing this app sends automatically is as
 * trustworthy as what the person holding the phone wrote (the old
 * pre-written request is gone with every other default message; see
 * `components/whatsapp-compose.tsx`). With no number configured the button
 * hides: a dead wa.me link is worse than an honest "contact your super
 * admin".
 */
import { MessageCircle, RefreshCw, ShieldAlert } from 'lucide-react-native';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { WhatsAppCompose } from '@/components/whatsapp-compose';
import {
  APP_VERSION,
  fetchVersionGate,
  needsUpdate,
  type VersionGateConfig,
} from '@/lib/app-config';
import { useColor } from '@/hooks/useColor';

type GateState =
  | { status: 'checking' }
  | { status: 'open' }
  | { status: 'locked'; config: VersionGateConfig };

export function VersionGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ status: 'checking' });

  const check = useCallback(async () => {
    const config = await fetchVersionGate();
    setState(
      config && needsUpdate(config)
        ? { status: 'locked', config }
        : { status: 'open' }
    );
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  // 'checking' renders the app — see the file header's fail-open contract.
  if (state.status !== 'locked') return <>{children}</>;
  return <UpdateLock config={state.config} onRetry={check} />;
}

function UpdateLock({
  config,
  onRetry,
}: {
  config: VersionGateConfig;
  onRetry: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [checking, setChecking] = useState(false);
  /** Whether the compose sheet is up. The sheet carries its own message. */
  const [composing, setComposing] = useState(false);

  const background = useColor('background');
  const card = useColor('card');
  const border = useColor('border');
  const outline = useColor('outline');
  const primary = useColor('primary');

  const supportPhone = config.supportPhone || '';

  const retry = async () => {
    setChecking(true);
    try {
      await onRetry();
    } finally {
      setChecking(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: background }]}>
      <View style={[styles.card, { backgroundColor: card, borderColor: border }]}>
        <View style={[styles.badge, { borderColor: border }]}>
          <Icon name={ShieldAlert} size={30} color='#F59E0B' />
        </View>

        <Text variant='subtitle' style={styles.title}>
          {t('update.title')}
        </Text>
        <Text variant='caption' style={[styles.body, { color: outline }]}>
          {t('update.body', {
            version: APP_VERSION,
            required: config.requiredVersion,
          })}
        </Text>

        <View style={styles.versionRow}>
          <View style={[styles.versionChip, { borderColor: border }]}>
            <Text variant='caption' style={{ color: outline }}>
              {t('update.yourVersion')}
            </Text>
            <Text variant='caption' style={styles.versionValue}>
              {APP_VERSION}
            </Text>
          </View>
          <View style={[styles.versionChip, { borderColor: border }]}>
            <Text variant='caption' style={{ color: outline }}>
              {t('update.requiredVersion')}
            </Text>
            <Text variant='caption' style={styles.versionValue}>
              {config.requiredVersion}
            </Text>
          </View>
        </View>

        {supportPhone ? (
          <Pressable
            accessibilityRole='button'
            accessibilityLabel={t('update.cta')}
            onPress={() => setComposing(true)}
            style={({ pressed }) => [
              styles.primaryButton,
              { backgroundColor: primary, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Icon name={MessageCircle} size={17} color='#FFFFFF' />
            <Text style={styles.primaryLabel}>{t('update.cta')}</Text>
          </Pressable>
        ) : (
          <Text variant='caption' style={[styles.noContact, { color: outline }]}>
            {t('update.noContact')}
          </Text>
        )}

        <Pressable
          accessibilityRole='button'
          onPress={() => void retry()}
          disabled={checking}
          style={({ pressed }) => [styles.retry, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Icon name={RefreshCw} size={14} color={outline} />
          <Text variant='caption' style={{ color: outline }}>
            {checking ? t('update.checking') : t('update.retry')}
          </Text>
        </Pressable>

        {/* The message the CTA sends is the reader's own — saved by them if
            they wrote one, nothing at all otherwise. Mounted permanently: the
            sheet runs its own close animation. */}
        <WhatsAppCompose
          visible={composing}
          phone={supportPhone}
          onClose={() => setComposing(false)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 24,
    alignItems: 'center',
    gap: 10,
  },
  badge: {
    width: 64,
    height: 64,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.10)',
    marginBottom: 2,
  },
  title: { textAlign: 'center' },
  body: { textAlign: 'center', lineHeight: 19 },
  versionRow: { flexDirection: 'row', gap: 8, marginVertical: 4 },
  versionChip: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    gap: 2,
    minWidth: 110,
  },
  versionValue: { fontWeight: '700', fontSize: 14 },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 20,
    width: '100%',
    marginTop: 6,
  },
  primaryLabel: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  noContact: { textAlign: 'center', lineHeight: 18, marginTop: 6 },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 2,
  },
});