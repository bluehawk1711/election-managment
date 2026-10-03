import { dueLabel } from '@/app/(tabs)/more/tasks/due';
import { useConfirm } from '@/components/campaign/confirm-dialog';
import { StatusBadge } from '@/components/campaign/status-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollView } from '@/components/ui/scroll-view';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { View } from '@/components/ui/view';
import { useColor } from '@/hooks/useColor';
import { useAction } from '@/hooks/useAction';
import { useTasks } from '@/hooks/useTasks';
import { formatDateTime } from '@/lib/format';
import type { TaskStatus } from '@/lib/models';
import { useReference } from '@/providers/reference-provider';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

const TRANSITIONS: TaskStatus[] = ['pending', 'in_progress', 'completed', 'issue'];

const STATUS_I18N: Record<TaskStatus, 'status.pending' | 'status.inProgress' | 'status.completed' | 'status.issue'> = {
  pending: 'status.pending',
  in_progress: 'status.inProgress',
  completed: 'status.completed',
  issue: 'status.issue',
};

/** Task detail — status transitions, report, inline edit, delete. */
export default function TaskDetailScreen() {
  const { t, i18n } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const run = useAction();
  const confirm = useConfirm();
  const reference = useReference();
  const { tasks, loading, update, setStatus, remove } = useTasks();

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [report, setReport] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  const outline = useColor('outline');
  const task = tasks.find((candidate) => candidate.id === id);

  const pad = { padding: 20, paddingBottom: 112, gap: 16 };

  if (loading && !task) {
    return (
      <ScrollView contentContainerStyle={pad}>
        <Stack.Screen options={{ title: t('tasks.title') }} />
        <Skeleton height={120} variant='rounded' />
        <Skeleton height={200} variant='rounded' />
        <Skeleton height={160} variant='rounded' />
      </ScrollView>
    );
  }

  if (!task) {
    return (
      <ScrollView contentContainerStyle={pad}>
        <Stack.Screen options={{ title: t('tasks.title') }} />
        <Text variant='subtitle'>{t('common.notFound')}</Text>
        <Button variant='outline' onPress={() => router.back()}>
          {t('common.back')}
        </Button>
      </ScrollView>
    );
  }

  const due = dueLabel(task.dueDate, now, t, i18n.language);
  const assignee = reference.memberName(task.assigneeId) || t('common.none');
  const reportValue = report ?? task.report;

  const startEdit = () => {
    setTitle(task.title);
    setDescription(task.description);
    setEditing(true);
  };

  const saveEdit = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const ok = await run(
      () => update(task.id, { title: trimmed, description: description.trim() }),
      { success: t('common.savedToast') }
    );
    if (ok) setEditing(false);
  };

  const saveReport = async () => {
    const ok = await run(() => update(task.id, { report: reportValue.trim() }), {
      success: t('common.savedToast'),
    });
    if (ok) setReport(null);
  };

  const deleteTask = async () => {
    const ok = await confirm.confirm({
      title: t('common.deleteTitle', { name: task.title }),
      body: t('common.deleteBody'),
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (!ok) return;
    const done = await run(() => remove(task.id), { success: t('common.deletedToast') });
    if (done) router.back();
  };

  return (
    <ScrollView contentContainerStyle={pad} keyboardShouldPersistTaps='handled'>
      <Stack.Screen options={{ title: editing ? t('common.edit') : task.title }} />

      <View style={styles.titleRow}>
        <View style={styles.grow}>
          {editing ? (
            <Input
              label={t('common.name')}
              value={title}
              onChangeText={setTitle}
              maxLength={200}
              autoFocus
            />
          ) : (
            <Text style={styles.title}>{task.title}</Text>
          )}
        </View>
        <StatusBadge status={task.status} />
      </View>

      {editing ? (
        <Input
          type='textarea'
          rows={4}
          label={t('common.description')}
          value={description}
          onChangeText={setDescription}
          maxLength={2000}
        />
      ) : task.description ? (
        <Text variant='body' style={{ color: outline }}>
          {task.description}
        </Text>
      ) : null}

      <Card style={{ gap: 10 }}>
        <MetaRow label={t('common.assignee')} value={assignee} />
        <MetaRow label={t('common.area')} value={reference.areaContext(task.areaId)} />
        <MetaRow label={t('common.deadline')} value={due.text} danger={due.overdue} />
        <MetaRow
          label={t('common.updated')}
          value={task.updatedAt != null ? formatDateTime(task.updatedAt, i18n.language) : '—'}
        />
      </Card>

      <Card style={{ gap: 10 }}>
        <Text style={styles.cardTitle}>{t('common.status')}</Text>
        <View style={styles.chipRow}>
          {TRANSITIONS.filter((status) => status !== task.status).map((status) => (
            <Button
              key={status}
              size='sm'
              variant='outline'
              onPress={async () => {
                await run(() => setStatus(task.id, status), {
                  success: t('common.savedToast'),
                });
              }}
            >
              {t(STATUS_I18N[status])}
            </Button>
          ))}
        </View>
      </Card>

      <Card style={{ gap: 10 }}>
        <Text style={styles.cardTitle}>{t('tasks.report')}</Text>
        <Input
          type='textarea'
          rows={3}
          placeholder={t('tasks.reportHint')}
          value={reportValue}
          onChangeText={setReport}
          maxLength={2000}
        />
        <Button size='sm' variant='outline' onPress={saveReport}>
          {t('common.save')}
        </Button>
      </Card>

      <View style={styles.actions}>
        {editing ? (
          <>
            <Button style={styles.grow} onPress={saveEdit} disabled={!title.trim()}>
              {t('common.save')}
            </Button>
            <Button style={styles.grow} variant='ghost' onPress={() => setEditing(false)}>
              {t('common.cancel')}
            </Button>
          </>
        ) : (
          <>
            <Button style={styles.grow} variant='outline' onPress={startEdit}>
              {t('common.edit')}
            </Button>
            <Button style={styles.grow} variant='destructive' onPress={deleteTask}>
              {t('common.delete')}
            </Button>
          </>
        )}
      </View>

      {confirm.dialog}
    </ScrollView>
  );
}

function MetaRow({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  const outline = useColor('outline');
  const errorColor = useColor('error');
  return (
    <View style={styles.metaRow}>
      <Text variant='caption' style={{ color: outline }}>
        {label}
      </Text>
      <Text
        variant='caption'
        style={[styles.metaValue, danger ? { color: errorColor } : null]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: {
    padding: 20,
    paddingBottom: 112,
    gap: 16,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  grow: {
    flex: 1,
  },
  title: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '600',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  metaValue: {
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'right',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
});
