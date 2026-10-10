import { dueLabel } from '@/lib/tasks/due';
import { FilterBar, FilterItem } from '@/components/campaign/filter-bar';
import { ListRow } from '@/components/campaign/list-row';
import { SearchInput } from '@/components/campaign/search-input';
import { SelectField } from '@/components/campaign/select-field';
import { StatusBadge } from '@/components/campaign/status-badge';
import { EmptyState } from '@/components/campaign/empty-state';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollView } from '@/components/ui/scroll-view';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { useToast } from '@/components/ui/toast';
import { View } from '@/components/ui/view';
import { useTasks } from '@/hooks/useTasks';
import type { TaskStatus } from '@/lib/models';
import { useReference } from '@/providers/reference-provider';
import { useRouter } from 'expo-router';
import { ClipboardList, Plus } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const STATUS_FILTERS: (TaskStatus | 'all')[] = ['all', 'pending', 'in_progress', 'completed', 'issue'];

const STATUS_KEY: Record<TaskStatus, string> = {
  pending: 'status.pending',
  in_progress: 'status.inProgress',
  completed: 'status.completed',
  issue: 'status.issue',
};

/** Tasks tab — search, status/assignee filters, due-date ordering. */
export default function TasksScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const reference = useReference();
  const { tasks, loading, error, retry } = useTasks();

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<TaskStatus | 'all'>('all');
  const [assigneeId, setAssigneeId] = useState('');
  const [now] = useState(() => Date.now());

  useEffect(() => {
    if (error) toast.error(t('common.errorTitle'), error);
  }, [error, toast, t]);

  const statusItems = useMemo<FilterItem[]>(
    () =>
      STATUS_FILTERS.map((key) => ({
        key,
        label: key === 'all' ? t('common.all') : t(STATUS_KEY[key as TaskStatus] as 'status.pending'),
        active: status === key,
      })),
    [status, t]
  );

  const assigneeOptions = useMemo(
    () => [
      { value: '', label: t('common.all') },
      ...reference.team.map((member) => ({ value: member.id, label: member.name })),
    ],
    [reference.team, t]
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tasks
      .filter((task) => (status === 'all' ? true : task.status === status))
      .filter((task) => (assigneeId ? task.assigneeId === assigneeId : true))
      .filter((task) =>
        needle
          ? task.title.toLowerCase().includes(needle) ||
            task.description.toLowerCase().includes(needle)
          : true
      )
      .sort((a, b) => {
        const aDue = a.dueDate ?? Number.MAX_SAFE_INTEGER;
        const bDue = b.dueDate ?? Number.MAX_SAFE_INTEGER;
        if (aDue !== bDue) return aDue - bDue;
        return (b.createdAt ?? 0) - (a.createdAt ?? 0);
      });
  }, [tasks, status, assigneeId, query]);

  const emptyFiltered = !loading && filtered.length === 0 && tasks.length > 0;
  const emptyAll = !loading && tasks.length === 0;

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
        <Button size='icon' onPress={() => router.push('/(tabs)/more/tasks/new')} accessibilityLabel={t('tasks.create')}>
          <Plus size={20} />
        </Button>
      </View>

      <FilterBar items={statusItems} onToggle={(key) => setStatus(key as TaskStatus | 'all')} />

      <SelectField
        label={t('common.assignee')}
        value={assigneeId}
        placeholder={t('common.all')}
        options={assigneeOptions}
        onChange={setAssigneeId}
      />

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
          icon={ClipboardList}
          title={t('common.empty')}
          body={t('tasks.emptyBody')}
          actionLabel={t('tasks.create')}
          onAction={() => router.push('/(tabs)/more/tasks/new')}
        />
      ) : emptyFiltered ? (
        <EmptyState icon={ClipboardList} title={t('tasks.noMatches')} body={t('tasks.noMatchesBody')} />
      ) : (
        <View style={{ gap: 8 }}>
          <Text variant='caption'>{t('common.items', { count: filtered.length })}</Text>
          {filtered.map((task) => {
            const due = dueLabel(task.dueDate, now, t, i18n.language);
            const assignee = reference.memberName(task.assigneeId);
            return (
              <ListRow
                key={task.id}
                title={task.title}
                subtitle={[assignee, reference.areaContext(task.areaId)]
                  .filter(Boolean)
                  .join(' · ')}
                meta={due.text}
                tone={
                  task.status === 'completed'
                    ? 'success'
                    : task.status === 'in_progress'
                      ? 'info'
                      : 'warning'
                }
                onPress={() =>
                  router.push({ pathname: '/(tabs)/more/tasks/[id]', params: { id: task.id } })
                }
                trailing={<StatusBadge status={task.status} />}
              />
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}
