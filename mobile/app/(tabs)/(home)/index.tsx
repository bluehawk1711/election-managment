import { ActivityCard, ActivityRow } from '@/components/dashboard/activity-card';
import { AttentionCard, AttentionRow } from '@/components/dashboard/attention-card';
import { CoverageCard } from '@/components/dashboard/coverage-card';
import { DashboardHeader } from '@/components/dashboard/dashboard-header';
import { FieldworkCard } from '@/components/dashboard/fieldwork-card';
import { GreetingRow } from '@/components/dashboard/greeting-row';
import { HeroCard } from '@/components/dashboard/hero-card';
import { IssuesCard } from '@/components/dashboard/issues-card';
import { MetricTile } from '@/components/dashboard/metric-tile';
import { QuickActionsRow } from '@/components/dashboard/quick-actions-row';
import { ScheduleCard } from '@/components/dashboard/schedule-card';
import { TaskCompletionCard } from '@/components/dashboard/task-completion';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollView } from '@/components/ui/scroll-view';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { useToast } from '@/components/ui/toast';
import { View } from '@/components/ui/view';
import { useAuth } from '@/providers/auth-provider';
import { useEvents } from '@/hooks/useEvents';
import { useExpenses } from '@/hooks/useExpenses';
import { useFieldwork } from '@/hooks/useFieldwork';
import { useIssues } from '@/hooks/useIssues';
import { useTasks } from '@/hooks/useTasks';
import { addDays, daysBetween, startOfDay } from '@/lib/dates';
import {
  activityFeed,
  attentionItems,
  boothCoverageRatio,
  completedToday,
  completionRate,
  dailyCounts,
  eventsThisWeek,
  issueBreakdown,
  openIssueCount,
  pendingTaskCount,
  readinessIndex,
  resolutionRate,
  sumExpenses,
  upcomingEvents,
  weeklyCompletionDelta,
} from '@/lib/dashboard-data';
import { formatCompactCurrency, formatDurationLong } from '@/lib/format';
import { useReference } from '@/providers/reference-provider';
import { useRouter } from 'expo-router';
import { CalendarPlus, Flag, TriangleAlert, Users } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TranslationKey } from '@/i18n/locales/en';
import type { ExpenseCategory, IssueCategory } from '@/lib/models';

const ISSUE_CAT_KEY: Record<IssueCategory, TranslationKey> = {
  road: 'issues.cat.road',
  water: 'issues.cat.water',
  electricity: 'issues.cat.electricity',
  drainage: 'issues.cat.drainage',
  streetlight: 'issues.cat.streetlight',
  sanitation: 'issues.cat.sanitation',
};

const EXPENSE_CAT_KEY: Record<ExpenseCategory, TranslationKey> = {
  travel: 'expenses.cat.travel',
  fuel: 'expenses.cat.fuel',
  materials: 'expenses.cat.materials',
  printing: 'expenses.cat.printing',
  food: 'expenses.cat.food',
  venue: 'expenses.cat.venue',
  other: 'expenses.cat.other',
};

/**
 * Dashboard — the campaign's command surface. Every number is derived from
 * live Firestore collections through `lib/dashboard-data` (pure, tested);
 * the layout mirrors the light mock section for section.
 */
export default function HomeScreen() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const router = useRouter();
  const reference = useReference();
  const { user, profile } = useAuth();

  const { tasks, loading: tasksLoading, error: tasksError, retry: retryTasks } = useTasks();
  const { issues, loading: issuesLoading } = useIssues();
  const { events, loading: eventsLoading } = useEvents();
  const { expenses, loading: expensesLoading } = useExpenses();
  const fieldwork = useFieldwork();

  const loading =
    reference.loading || tasksLoading || issuesLoading || eventsLoading || expensesLoading;
  const error = reference.error ?? tasksError;

  useEffect(() => {
    if (error) toast.error(t('common.errorTitle'), error);
  }, [error, toast, t]);

  // Today's stamp, read once after mount (purity rules keep Date.now out of
  // the render body); "—" placeholders cover that single first frame.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setNow(Date.now()), 0);
    return () => clearTimeout(timer);
  }, []);

  const buckets = useMemo(() => {
    if (now == null) return [];
    const today = startOfDay(now);
    return Array.from({ length: 30 }, (_, index) => addDays(today, index - 29));
  }, [now]);

  const metrics = useMemo(() => {
    if (now == null) return null;
    const staffed = reference.booths.filter((booth) => booth.coordinatorId !== '').length;
    const coverage = boothCoverageRatio(reference.booths);
    const weekDone = dailyCounts(
      tasks.filter((task) => task.status === 'completed').map((task) => task.updatedAt),
      7,
      now
    );
    const weekIssues = dailyCounts(
      issues.map((issue) => issue.reportedAt),
      7,
      now
    );
    const weekEvents = dailyCounts(
      events.map((event) => event.startsAt),
      7,
      now
    );
    const weekSpend = Array.from({ length: 7 }, () => 0);
    for (const expense of expenses) {
      const age = daysBetween(startOfDay(expense.date), startOfDay(now));
      if (age >= 0 && age < 7) weekSpend[6 - age] += expense.amount;
    }
    return {
      readiness: readinessIndex({
        coverage: coverage * 100,
        taskRate: completionRate(tasks) * 100,
        issueRate: resolutionRate(issues) * 100,
      }),
      trend: weeklyCompletionDelta(tasks, now),
      staffed,
      totalBooths: reference.booths.length,
      activeWorkers: reference.team.filter((member) => member.status === 'active').length,
      doneToday: completedToday(tasks, now),
      pendingTasks: pendingTaskCount(tasks),
      openIssues: openIssueCount(issues),
      weekEventCount: eventsThisWeek(events, now),
      expenseTotal: sumExpenses(expenses),
      series: {
        tasks: weekDone,
        issues: weekIssues,
        events: weekEvents,
        spend: weekSpend,
      },
      completion30: dailyCounts(
        tasks.filter((task) => task.status === 'completed').map((task) => task.updatedAt),
        30,
        now
      ),
      breakdown: issueBreakdown(issues),
      attention: attentionItems({ tasks, booths: reference.booths, issues, now }),
      upcoming: upcomingEvents(events, now),
      feed: activityFeed({ tasks, expenses, issues }),
      hour: new Date(now).getHours(),
      campaignDay:
        reference.campaign?.startDate != null
          ? daysBetween(reference.campaign.startDate, now) + 1
          : null,
      daysToPolling:
        reference.campaign?.electionDate != null
          ? Math.max(0, daysBetween(now, reference.campaign.electionDate))
          : null,
    };
  }, [now, reference, tasks, issues, events, expenses]);

  const name = profile?.displayName || user?.email?.split('@')[0] || t('dash.unknownActor');
  const initials = initialsOf(name);

  const attentionRows = useMemo<AttentionRow[]>(() => {
    if (metrics == null || now == null) return [];
    return metrics.attention.map((item) => {
      if (item.kind === 'booth') {
        const booth = reference.booths.find((candidate) => candidate.id === item.refId);
        return {
          id: item.id,
          icon: Flag,
          title: t('dash.boothTitle', { number: booth?.number ?? '' }),
          subtitle: t('dash.noCoordinator'),
          meta: reference.areaContext(booth?.areaId ?? ''),
          actionLabel: t('dash.assign'),
          // To the booth REPORT, not the hidden Booths tab: the report
          // derives its numbers from the roll bundle and always has data,
          // while the tab's Firestore source was never seeded.
          onPress: () => router.push('/(tabs)/reports'),
          onAction: () => router.push('/(tabs)/reports'),
        };
      }
      if (item.kind === 'task') {
        const task = tasks.find((candidate) => candidate.id === item.refId);
        const overdueBy = task?.dueDate != null ? formatDurationLong(now - task.dueDate, i18n.language) : '';
        return {
          id: item.id,
          icon: TriangleAlert,
          title: item.title,
          subtitle: t('dash.taskOverdue'),
          meta: `${overdueBy} · ${reference.areaContext(task?.areaId ?? '')}`,
          actionLabel: t('dash.nudge'),
          onPress: () =>
            router.push({ pathname: '/(tabs)/more/tasks/[id]', params: { id: item.refId } }),
          onAction: () =>
            router.push({ pathname: '/(tabs)/more/tasks/[id]', params: { id: item.refId } }),
        };
      }
      const issue = issues.find((candidate) => candidate.id === item.refId);
      const ago = issue?.reportedAt != null ? formatDurationLong(now - issue.reportedAt, i18n.language) : '';
      return {
        id: item.id,
        icon: TriangleAlert,
        title: item.title,
        subtitle: t(ISSUE_CAT_KEY[issue?.category ?? 'road']),
        meta: `${ago} · ${reference.areaContext(issue?.areaId ?? '')}`,
        actionLabel: t('dash.escalate'),
        onPress: () => router.push('/(tabs)/more/issues'),
        onAction: () => router.push('/(tabs)/more/issues'),
      };
    });
  }, [metrics, now, reference, tasks, issues, router, t, i18n.language]);

  const activityRows = useMemo<ActivityRow[]>(() => {
    if (metrics == null || now == null) return [];
    return metrics.feed.map((entry) => {
      const actor = nameOf(entry.actorId);
      const action =
        entry.kind === 'task'
          ? t('dash.actTask', { title: entry.title })
          : entry.kind === 'expense'
            ? t('dash.actExpense', {
                amount: formatCompactCurrency(entry.amount ?? 0, i18n.language),
              })
            : t('dash.actIssue', { title: entry.title });
      const context =
        entry.kind === 'expense'
          ? t(EXPENSE_CAT_KEY[entry.title as ExpenseCategory] ?? 'expenses.cat.other')
          : reference.areaContext(entry.areaId);
      return {
        id: entry.id,
        name: actor,
        initials: initialsOf(actor),
        action,
        meta: `${formatDurationLong(now - entry.at, i18n.language)} · ${context}`,
      };
    });

    function nameOf(actorId: string): string {
      if (!actorId) return t('dash.unknownActor');
      if (actorId === user?.uid) return name;
      return reference.memberName(actorId) || t('dash.unknownActor');
    }
  }, [metrics, now, reference, t, user?.uid, name, i18n.language]);

  const greetingKey =
    metrics != null && metrics.hour < 12
      ? 'dash.greetingMorning'
      : metrics != null && metrics.hour < 17
        ? 'dash.greetingAfternoon'
        : 'dash.greetingEvening';

  const metaLine =
    metrics == null
      ? ''
      : [
          metrics.campaignDay != null ? t('dash.campaignDay', { day: metrics.campaignDay }) : null,
          metrics.daysToPolling != null ? t('dash.pollingIn', { days: metrics.daysToPolling }) : null,
        ]
          .filter(Boolean)
          .join(' · ');

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{
        paddingTop: 0,
        paddingBottom: 112,
        gap: 16,
      }}
      keyboardShouldPersistTaps='handled'
    >
      <DashboardHeader
        title={t('dash.brandTitle')}
        subtitle={t('home.title')}
        // Search belongs to the roll. It used to open the More hub, which was
        // never what the magnifier implied — a user tapping search is looking
        // for a person, and the voter list is where people are.
        onSearch={() => router.push('/(tabs)/voters')}
      />

      <View style={{ paddingHorizontal: 20, gap: 16 }}>
        <GreetingRow
          greeting={t(greetingKey as 'dash.greetingMorning', { name })}
          meta={metaLine}
          initials={initials}
          bellLabel={t('dash.notifications')}
          tuneLabel={t('dash.settings')}
          onBell={() => toast.info(t('dash.notifications'), t('dash.noNotifications'))}
          onTune={() => router.push('/(tabs)/more/settings')}
        />

        {loading || metrics == null || now == null ? (
          <View style={{ gap: 8 }}>
            <Skeleton height={230} variant='rounded' />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Skeleton height={44} variant='rounded' style={{ flex: 1 }} />
              <Skeleton height={44} variant='rounded' style={{ flex: 1 }} />
              <Skeleton height={44} variant='rounded' style={{ flex: 1 }} />
              <Skeleton height={44} variant='rounded' style={{ flex: 1 }} />
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Skeleton height={148} variant='rounded' style={{ flex: 1 }} />
              <Skeleton height={148} variant='rounded' style={{ flex: 1 }} />
            </View>
            <Skeleton height={260} variant='rounded' />
          </View>
        ) : (
          <>
            <HeroCard
              title={t('dash.readiness')}
              trendLabel={
                metrics.trend != null
                  ? t('dash.trendWeek', {
                      trend: `${metrics.trend >= 0 ? '+' : ''}${metrics.trend}%`,
                    })
                  : null
              }
              index={metrics.readiness}
              indexLabel={t('dash.index')}
              stats={[
                {
                  label: t('dash.boothsCovered'),
                  value: `${metrics.staffed} / ${metrics.totalBooths}`,
                },
                { label: t('dash.activeWorkers'), value: String(metrics.activeWorkers) },
                { label: t('dash.tasksDoneToday'), value: String(metrics.doneToday) },
              ]}
            />

            <QuickActionsRow
              onNewTask={() => router.push('/(tabs)/more/tasks/new')}
              onReportIssue={() => router.push('/(tabs)/more/issues/new')}
              onAddEvent={() => router.push('/(tabs)/more/calendar')}
              // The booth REPORT, not the hidden Booths tab — see the note in
              // `attentionRows` above.
              onBoothIn={() => router.push('/(tabs)/reports')}
            />

            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <MetricTile
                  icon={CalendarPlus}
                  chipLabel={t('dash.chipActive')}
                  chipTone='success'
                  value={String(metrics.pendingTasks)}
                  label={t('dash.metricPendingTasks')}
                  series={metrics.series.tasks}
                  colorName='secondary'
                  onPress={() => router.push('/(tabs)/more/tasks')}
                />
                <MetricTile
                  icon={TriangleAlert}
                  chipLabel={t('dash.chipCritical')}
                  chipTone={metrics.openIssues > 0 ? 'danger' : 'default'}
                  value={String(metrics.openIssues)}
                  label={t('dash.metricOpenIssues')}
                  series={metrics.series.issues}
                  colorName='error'
                  onPress={() => router.push('/(tabs)/more/issues')}
                />
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <MetricTile
                  icon={Users}
                  chipLabel={t('dash.chipSynced')}
                  chipTone='default'
                  value={String(metrics.weekEventCount)}
                  label={t('dash.metricMeetings')}
                  series={metrics.series.events}
                  colorName='primary'
                  onPress={() => router.push('/(tabs)/more/calendar')}
                />
                <MetricTile
                  icon={Flag}
                  chipLabel={t('dash.chipAudit')}
                  chipTone='default'
                  value={formatCompactCurrency(metrics.expenseTotal, i18n.language)}
                  label={t('dash.metricExpenses')}
                  series={metrics.series.spend}
                  colorName='tertiary'
                  onPress={() => router.push('/(tabs)/more/expenses')}
                />
              </View>
            </View>

            {/* Every card below is a door: tap it and you land on the screen
                that owns the number, not on a dead surface. */}
            <Pressable onPress={() => router.push('/(tabs)/voters')}>
              <Card>
                {/* The account's own filled/edited counters (demand #6) —
                    personal work, not campaign totals, so it sits directly
                    under the metric grid where a karykarta looks first. */}
                <FieldworkCard
                  stats={fieldwork.stats}
                  ratio={fieldwork.ratio}
                  queued={fieldwork.queued}
                  title={t('dash.fieldwork')}
                  coverageLabel={t('dash.fwCoverage', {
                    done: fieldwork.stats.edited,
                    total: fieldwork.stats.totalVoters,
                  })}
                  tiles={{
                    edited: t('dash.fwEdited'),
                    phones: t('dash.fwPhones'),
                    photos: t('dash.fwPhotos'),
                    voted: t('dash.fwVoted'),
                  }}
                  pendingLabel={t('dash.fwPending', { count: fieldwork.queued })}
                />
              </Card>
            </Pressable>

            <Pressable onPress={() => router.push('/(tabs)/more/tasks')}>
              <Card>
                <TaskCompletionCard counts={metrics.completion30} buckets={buckets} />
              </Card>
            </Pressable>

            <Pressable onPress={() => router.push('/(tabs)/voters')}>
              <Card>
                <CoverageCard
                  rails={reference.wardCoverage}
                  title={t('dash.coverage')}
                  subtitle={t('dash.coverageSub', { percent: 60 })}
                  hint={t('dash.wardsCount', { count: reference.wardCoverage.length })}
                />
              </Card>
            </Pressable>

            <Card>
              <IssuesCard
                breakdown={metrics.breakdown}
                subtitle={t('dash.issuesSub')}
                totalLabel={t('dash.totalIssues')}
                actionLabel={t('common.viewAll')}
                onAction={() => router.push('/(tabs)/more/issues')}
              />
            </Card>

            <Card>
              <AttentionCard
                rows={attentionRows}
                title={t('dash.attention')}
                countLabel={t('dash.attentionCount', { count: attentionRows.length })}
                actionLabel={t('common.viewAll')}
                onAction={() => router.push('/(tabs)/more/tasks')}
              />
            </Card>

            <Card>
              <ScheduleCard
                events={metrics.upcoming}
                title={t('dash.schedule')}
                subtitle={
                  reference.connected ? t('dash.calendarSync') : t('dash.calendarLocal')
                }
                locationLabel={t('common.location')}
                onSelect={() => router.push('/(tabs)/more/calendar')}
                onAll={() => router.push('/(tabs)/more/calendar')}
                allLabel={t('common.viewAll')}
              />
            </Card>

            <Card>
              <ActivityCard
                rows={activityRows}
                title={t('dash.recentActivity')}
              />
            </Card>

            {error ? (
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
            ) : null}
          </>
        )}
      </View>
    </ScrollView>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
