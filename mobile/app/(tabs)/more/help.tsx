/**
 * Help — the app's manual, in the user's own language.
 *
 * Every question a karykarta has actually had in the field, written out in
 * full rather than as one-liners: how the roll search works, why a phone
 * number has its own card, what "pending sync" means, why an account locks
 * itself on a second device, and what the "Update required" modal is. The
 * answers live in the locale files (EN + HI) like every other string, so a
 * reader who switched the app to Hindi reads the help in Hindi too.
 *
 * ## The accordion
 *
 * One section open at a time — a manual where everything is expanded at once
 * is a wall nobody reads. The chevron rotates with the open state and the
 * section key is the state, so reopening the screen lands on the first
 * section rather than on nothing. No animation library: the content simply
 * mounts and unmounts, which on these short answers is instant.
 *
 * ## Support
 *
 * The WhatsApp line is READ from `appConfig/general` (the same doc the
 * update gate uses — the number is configured once, in the admin panel's
 * Settings page). When it is set, the page ends with a real button that
 * opens a chat with a pre-filled "I need help with the app" message;
 * without it the section still explains where the number will appear.
 */
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { ScrollView } from '@/components/ui/scroll-view';
import { Text } from '@/components/ui/text';
import { View } from '@/components/ui/view';
import { useColor } from '@/hooks/useColor';
import { fetchVersionGate } from '@/lib/app-config';
import { whatsappUrl } from '@/lib/contact';
import { ChevronDown } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, StyleSheet } from 'react-native';

interface HelpItem {
  q: string;
  a: string;
}

interface HelpSectionData {
  key: string;
  title: string;
  items: HelpItem[];
}

/** One question and its answer — bold question, breathing-room answer. */
function HelpItemView({ item }: { item: HelpItem }) {
  const outline = useColor('outline');
  return (
    <View style={styles.item}>
      <Text variant='subtitle' style={styles.question}>
        {item.q}
      </Text>
      {/* Split on newlines so answers can use line breaks for lists without
          the markup leaking into the strings. */}
      {item.a.split('\n').map((line, index) => (
        <Text
          key={index}
          variant='caption'
          style={[styles.answer, { color: outline }]}
        >
          {line}
        </Text>
      ))}
    </View>
  );
}

/** One accordion row — the whole header is the tap target. */
function HelpSection({
  data,
  open,
  onToggle,
}: {
  data: HelpSectionData;
  open: boolean;
  onToggle: () => void;
}) {
  const border = useColor('border');
  const outline = useColor('outline');

  return (
    <Card style={styles.section}>
      <Pressable
        onPress={onToggle}
        accessibilityRole='button'
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.sectionHead, pressed && styles.pressed]}
      >
        <Text variant='subtitle' style={styles.sectionTitle}>
          {data.title}
        </Text>
        <Icon
          name={ChevronDown}
          size={18}
          color={outline}
          style={open ? styles.chevronOpen : undefined}
        />
      </Pressable>
      {open ? (
        <View style={[styles.items, { borderTopColor: border }]}>
          {data.items.map((item, index) => (
            <HelpItemView key={index} item={item} />
          ))}
        </View>
      ) : null}
    </Card>
  );
}

export default function HelpScreen() {
  const { t } = useTranslation();
  // One section open at a time; the first is the one nearly everyone opens.
  const [openKey, setOpenKey] = useState<string | null>('start');

  // The support line, configured once in the admin panel (Settings → app
  // version). Absent when the doc is missing/offline — the page still works,
  // it just cannot offer the button.
  const [supportPhone, setSupportPhone] = useState('');
  useEffect(() => {
    let alive = true;
    fetchVersionGate()
      .then((config) => {
        if (alive && config?.supportPhone) setSupportPhone(config.supportPhone);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const sections: HelpSectionData[] = [
    {
      key: 'start',
      title: t('help.start'),
      items: [
        { q: t('help.q.start.1'), a: t('help.a.start.1') },
        { q: t('help.q.start.2'), a: t('help.a.start.2') },
        { q: t('help.q.start.3'), a: t('help.a.start.3') },
      ],
    },
    {
      key: 'roll',
      title: t('help.roll'),
      items: [
        { q: t('help.q.roll.1'), a: t('help.a.roll.1') },
        { q: t('help.q.roll.2'), a: t('help.a.roll.2') },
        { q: t('help.q.roll.3'), a: t('help.a.roll.3') },
      ],
    },
    {
      key: 'edit',
      title: t('help.edit'),
      items: [
        { q: t('help.q.edit.1'), a: t('help.a.edit.1') },
        { q: t('help.q.edit.2'), a: t('help.a.edit.2') },
        { q: t('help.q.edit.3'), a: t('help.a.edit.3') },
      ],
    },
    {
      key: 'phones',
      title: t('help.phones'),
      items: [
        { q: t('help.q.phones.1'), a: t('help.a.phones.1') },
        { q: t('help.q.phones.2'), a: t('help.a.phones.2') },
        { q: t('help.q.phones.3'), a: t('help.a.phones.3') },
      ],
    },
    {
      key: 'fieldwork',
      title: t('help.fieldwork'),
      items: [
        { q: t('help.q.fieldwork.1'), a: t('help.a.fieldwork.1') },
        { q: t('help.q.fieldwork.2'), a: t('help.a.fieldwork.2') },
        { q: t('help.q.fieldwork.3'), a: t('help.a.fieldwork.3') },
      ],
    },
    {
      key: 'tasks',
      title: t('help.tasks'),
      items: [
        { q: t('help.q.tasks.1'), a: t('help.a.tasks.1') },
        { q: t('help.q.tasks.2'), a: t('help.a.tasks.2') },
        { q: t('help.q.tasks.3'), a: t('help.a.tasks.3') },
      ],
    },
    {
      key: 'events',
      title: t('help.events'),
      items: [
        { q: t('help.q.events.1'), a: t('help.a.events.1') },
        { q: t('help.q.events.2'), a: t('help.a.events.2') },
      ],
    },
    {
      key: 'issues',
      title: t('help.issues'),
      items: [
        { q: t('help.q.issues.1'), a: t('help.a.issues.1') },
        { q: t('help.q.issues.2'), a: t('help.a.issues.2') },
      ],
    },
    {
      key: 'expenses',
      title: t('help.expenses'),
      items: [
        { q: t('help.q.expenses.1'), a: t('help.a.expenses.1') },
        { q: t('help.q.expenses.2'), a: t('help.a.expenses.2') },
      ],
    },
    {
      key: 'team',
      title: t('help.team'),
      items: [
        { q: t('help.q.team.1'), a: t('help.a.team.1') },
        { q: t('help.q.team.2'), a: t('help.a.team.2') },
        { q: t('help.q.team.3'), a: t('help.a.team.3') },
      ],
    },
    {
      key: 'sync',
      title: t('help.sync'),
      items: [
        { q: t('help.q.sync.1'), a: t('help.a.sync.1') },
        { q: t('help.q.sync.2'), a: t('help.a.sync.2') },
        { q: t('help.q.sync.3'), a: t('help.a.sync.3') },
        { q: t('help.q.sync.4'), a: t('help.a.sync.4') },
      ],
    },
    {
      key: 'trouble',
      title: t('help.trouble'),
      items: [
        { q: t('help.q.trouble.1'), a: t('help.a.trouble.1') },
        { q: t('help.q.trouble.2'), a: t('help.a.trouble.2') },
        { q: t('help.q.trouble.3'), a: t('help.a.trouble.3') },
        { q: t('help.q.trouble.4'), a: t('help.a.trouble.4') },
      ],
    },
    {
      key: 'privacy',
      title: t('help.privacy'),
      items: [
        { q: t('help.q.privacy.1'), a: t('help.a.privacy.1') },
        { q: t('help.q.privacy.2'), a: t('help.a.privacy.2') },
      ],
    },
  ];

  const openSupport = () => {
    const url = whatsappUrl(
      supportPhone,
      '🙏🏻 मुझे ऐप से जुड़ी मदद चाहिए / I need help with the app.'
    );
    if (url) void Linking.openURL(url);
  };

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.body}
      keyboardShouldPersistTaps='handled'
    >
      <Text variant='caption'>{t('help.intro')}</Text>

      {sections.map((data) => (
        <HelpSection
          key={data.key}
          data={data}
          open={openKey === data.key}
          onToggle={() => setOpenKey(openKey === data.key ? null : data.key)}
        />
      ))}

      {/* Contact — the same configurable line the update gate uses. */}
      <Card style={styles.section}>
        <Text variant='subtitle'>{t('help.contact')}</Text>
        <Text variant='caption' style={styles.answer}>
          {t('help.contactBody')}
        </Text>
        {supportPhone ? (
          <Button size='sm' variant='outline' onPress={openSupport}>
            {t('help.contactAction')}
          </Button>
        ) : null}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // Extra bottom room for the floating tab bar (absolute overlay — see
  // components/nav/floating-tab-bar.tsx).
  body: { padding: 20, paddingTop: 12, paddingBottom: 112, gap: 12 },
  section: { gap: 10 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  sectionTitle: { flex: 1 },
  chevronOpen: { transform: [{ rotate: '180deg' }] },
  pressed: { opacity: 0.7 },
  items: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
    gap: 12,
  },
  item: { gap: 3 },
  question: { lineHeight: 22 },
  // 16px of top margin on every answer line after the first gives each
  // question-answer pair air without needing to wrap them in Views.
  answer: { lineHeight: 19 },
});
