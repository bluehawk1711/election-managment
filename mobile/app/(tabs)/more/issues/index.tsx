import { Chip } from '@/components/campaign/chip';
import { EmptyState } from '@/components/campaign/empty-state';
import { FilterBar, type FilterItem } from '@/components/campaign/filter-bar';
import { ListRow } from '@/components/campaign/list-row';
import { SearchInput } from '@/components/campaign/search-input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollView } from '@/components/ui/scroll-view';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { useToast } from '@/components/ui/toast';
import { View } from '@/components/ui/view';
import type { TranslationKey } from '@/i18n/locales/en';
import { useAction } from '@/hooks/useAction';
import { useIssues } from '@/hooks/useIssues';
import { formatDurationLong } from '@/lib/format';
import type { IssueCategory, IssueStatus } from '@/lib/models';
import { useRouter } from 'expo-router';
import { Plus, TriangleAlert } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const ISSUE_CAT_KEY: Record<IssueCategory, TranslationKey> = {
  road: 'issues.cat.road',
  water: 'issues.cat.water',
  electricity: 'issues.cat.electricity',
  drainage: 'issues.cat.drainage',
  streetlight: 'issues.cat.streetlight',
  sanitation: 'issues.cat.sanitation',
};

const STATUS_KEY: Record<IssueStatus, TranslationKey> = {
  open: 'status.open',
  in_progress: 'status.inProgress',
  resolved: 'status.resolved',
};

const STATUS_TONE: Record<IssueStatus, 'danger' | 'warning' | 'success'> = {
  open: 'danger',
  in_progress: 'warning',
  resolved: 'success',
};

/** The lifecycle one tap walks: open → in progress → resolved → reopened. */
const NEXT_STATUS: Record<IssueStatus, IssueStatus> = {
  open: 'in_progress',
  in_progress: 'resolved',
  resolved: 'open',
};

const STATUS_FILTERS: (IssueStatus | 'all')[] = ['all', 'open', 'in_progress', 'resolved'];

/**
 * Issues — civic problem reports, live from Firestore.
 *
 * The whole row is the status advance (open → in progress → resolved): the
 * team's most common action on this list is "we're on it" / "it's fixed",
 * and burying that in a detail screen would make every update two taps and
 * a navigation. The trailing chip shows where the issue stands; the hint
 * under the search says the row moves it.
 */
export default function IssuesScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const run = useAction();
  const { issues, loading, error, retry, setStatus } = useIssues();

  const [query, setQuery] = useState('');
  const [status, setStatusFilter] = useState<IssueStatus | 'all'>('all');
  const [now] = useState(() => Date.now());

  useEffect(() => {
    if (error) toast.error(t('common.errorTitle'), error);
  }, [error, toast, t]);

  const statusItems = useMemo<FilterItem[]>(
    () =>
      STATUS_FILTERS.map((key) => ({
        key,
        label:
          key === 'all'
            ? t('common.all')
            : t(STATUS_KEY[key as IssueStatus] as TranslationKey),
        active: status === key,
      })),
    [status, t]
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return issues
      .filter((issue) => (status === 'all' ? true : issue.status === status))
      .filter((issue) =>
        needle
          ? issue.title.toLowerCase().includes(needle) ||
            issue.description.toLowerCase().includes(needle)
          : true
      );
  }, [issues, status, query]);

  const emptyFiltered = !loading && filtered.length === 0 && issues.length > 0;
  const emptyAll = !loading && issues.length === 0;

  const advance = (id: string, current: IssueStatus) => {
    const next = NEXT_STATUS[current];
    void run(() => setStatus(id, next), {
      success: t(STATUS_KEY[next] as TranslationKey),
    });
  };

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: 112, gap: 12 }}
      keyboardShouldPersistTaps='handled'
    >
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <SearchInput value={query} onChangeText={setQuery} />
        </View>
        <Button
          size='icon'
          onPress={() => router.push('/(tabs)/more/issues/new')}
          accessibilityLabel={t('issues.create')}
        >
          <Plus size={20} />
        </Button>
      </View>

      <FilterBar items={statusItems} onToggle={(key) => setStatusFilter(key as IssueStatus | 'all')} />

      <Text variant='caption'>{t('issues.advanceHint')}</Text>

      {error ? (
        <Card style={{ gap: 12 }}>
          <Text variant='caption'>{error}</Text>
          <Button size='sm' variant='outline' onPress={retry}>
            {t('common.retry')}
          </Button>
        </Card>
      ) : null}

      {loading ? (
        <View style={{ gap: 8 }}>
          {[0, 1, 2, 3].map((row) => (
            <Skeleton key={row} height={76} variant='rounded' />
          ))}
        </View>
      ) : emptyAll ? (
        <EmptyState
          icon={TriangleAlert}
          title={t('common.empty')}
          body={t('issues.emptyBody')}
          actionLabel={t('issues.create')}
          onAction={() => router.push('/(tabs)/more/issues/new')}
        />
      ) : emptyFiltered ? (
        <EmptyState
          icon={TriangleAlert}
          title={t('issues.noMatches')}
          body={t('issues.noMatchesBody')}
        />
      ) : (
        <View style={{ gap: 8 }}>
          <Text variant='caption'>{t('common.items', { count: filtered.length })}</Text>
          {filtered.map((issue) => (
            <ListRow
              key={issue.id}
              title={issue.title}
              subtitle={t(ISSUE_CAT_KEY[issue.category])}
              meta={
                issue.reportedAt != null
                  ? formatDurationLong(now - issue.reportedAt, i18n.language)
                  : ''
              }
              icon={TriangleAlert}
              tone={issue.status === 'resolved' ? 'success' : 'danger'}
              onPress={() => advance(issue.id, issue.status)}
              trailing={
                <Chip label={t(STATUS_KEY[issue.status])} tone={STATUS_TONE[issue.status]} />
              }
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}
