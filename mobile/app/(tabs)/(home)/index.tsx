import { StatCard } from '@/components/dashboard/stat-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollView } from '@/components/ui/scroll-view';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { useToast } from '@/components/ui/toast';
import { View } from '@/components/ui/view';
import { useColor } from '@/hooks/useColor';
import { useIssues } from '@/hooks/useIssues';
import { useTasks } from '@/hooks/useTasks';
import { daysBetween } from '@/lib/dates';
import { useReference } from '@/providers/reference-provider';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Home tab. Placeholder shell: the real dashboard (turnout rails, booth
 * coverage, today's timeline) is the next build phase, but the data layer
 * underneath is live — the counts below come straight from Firestore.
 */
export default function HomeScreen() {
  const { t } = useTranslation();
  const toast = useToast();

  const reference = useReference();
  const { tasks, loading: tasksLoading, error: tasksError, retry: retryTasks } = useTasks();
  const { issues, loading: issuesLoading } = useIssues();

  const loading = reference.loading || tasksLoading || issuesLoading;
  const error = reference.error ?? tasksError;

  const green = useColor('green');
  const textMuted = useColor('textMuted');

  useEffect(() => {
    if (error) toast.error(t('common.errorTitle'), error);
  }, [error, toast, t]);

  // The countdown only needs today's stamp, not a live clock. Read it once
  // after mount (deferred, so the effect stays free of synchronous setState)
  // and treat a missing value as "—" for that single first frame.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setNow(Date.now()), 0);
    return () => clearTimeout(timer);
  }, []);

  const openTasks = tasks.filter((task) => task.status !== 'completed').length;
  const openIssues = issues.filter((issue) => issue.status !== 'resolved').length;
  const electionDate = reference.campaign?.electionDate;
  const daysToPolling =
    now != null && electionDate != null
      ? Math.max(0, daysBetween(now, electionDate))
      : null;

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{
        padding: 24,
        paddingTop: 120,
        // Clear the floating tab bar (dock 12 + pill ~56 + breathing room).
        paddingBottom: 112,
        gap: 16,
      }}
      keyboardShouldPersistTaps='handled'
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: reference.connected ? green : textMuted,
          }}
        />
        <Text variant='caption'>
          {reference.connected ? 'Live from Firestore' : 'Serving from cache…'}
        </Text>
        <View style={{ flex: 1 }} />
        <Badge>{`${tasks.length}`}</Badge>
      </View>

      <View>
        <Text variant='heading'>{t('home.title')}</Text>
        <Text variant='caption'>
          {t('home.subtitle', {
            campaign: reference.campaign?.name ?? '—',
            candidate: reference.campaign?.candidateName ?? '',
          })}
        </Text>
      </View>

      {loading ? (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Skeleton height={76} variant='rounded' style={{ flex: 1 }} />
            <Skeleton height={76} variant='rounded' style={{ flex: 1 }} />
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Skeleton height={76} variant='rounded' style={{ flex: 1 }} />
            <Skeleton height={76} variant='rounded' style={{ flex: 1 }} />
          </View>
          <Skeleton height={160} variant='rounded' />
        </View>
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <StatCard
              label={t('home.openTasks')}
              value={String(openTasks)}
              tone='accent'
            />
            <StatCard
              label={t('home.openIssues')}
              value={String(openIssues)}
              tone='warning'
            />
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <StatCard label={t('home.booths')} value={String(reference.booths.length)} />
            <StatCard
              label={t('home.daysToPolling')}
              value={daysToPolling != null ? String(daysToPolling) : '—'}
              tone='success'
            />
          </View>

          <Card style={{ gap: 8 }}>
            <Text variant='subtitle'>{t('home.title')}</Text>
            <Text variant='caption'>{t('home.placeholder')}</Text>
          </Card>

          {error && (
            <Card style={{ gap: 12 }}>
              <Text variant='caption'>{error}</Text>
              <Button
                size='sm'
                variant='outline'
                onPress={() => {
                  reference.retry();
                  retryTasks();
                }}
              >
                {t('common.retry')}
              </Button>
            </Card>
          )}
        </>
      )}
    </ScrollView>
  );
}
