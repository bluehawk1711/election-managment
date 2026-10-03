import { HierarchyPicker, HierarchyValue } from '@/components/campaign/hierarchy-picker';
import { DateField } from '@/components/campaign/date-field';
import { SelectField } from '@/components/campaign/select-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollView } from '@/components/ui/scroll-view';
import { Text } from '@/components/ui/text';
import { useAction } from '@/hooks/useAction';
import { useTasks } from '@/hooks/useTasks';
import { useReference } from '@/providers/reference-provider';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Create-task modal — title required, everything else optional per rules. */
export default function NewTaskScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const run = useAction();
  const reference = useReference();
  const { create } = useTasks();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [dueDate, setDueDate] = useState<number | null>(null);
  const [hierarchy, setHierarchy] = useState<HierarchyValue>({ wardId: '', areaId: '', boothId: '' });
  const [showError, setShowError] = useState(false);
  const [saving, setSaving] = useState(false);

  const trimmedTitle = title.trim();

  const assigneeOptions = reference.team
    .filter((member) => member.status === 'active')
    .map((member) => ({ value: member.id, label: member.name }));

  const submit = async () => {
    if (!trimmedTitle) {
      setShowError(true);
      return;
    }
    setSaving(true);
    const ok = await run(
      () =>
        create({
          title: trimmedTitle,
          description: description.trim(),
          assigneeId,
          areaId: hierarchy.areaId,
          boothId: hierarchy.boothId,
          dueDate,
          status: 'pending',
          report: '',
        }),
      { success: t('tasks.createdToast') }
    );
    setSaving(false);
    if (ok) router.back();
  };

  return (
    <ScrollView
      contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 14 }}
      keyboardShouldPersistTaps='handled'
    >
      <Input
        label={t('common.name')}
        placeholder={t('tasks.titlePlaceholder')}
        value={title}
        onChangeText={(next) => {
          setTitle(next);
          if (showError) setShowError(false);
        }}
        error={showError && !trimmedTitle ? t('tasks.titleRequired') : undefined}
        maxLength={200}
        autoFocus
      />

      <Input
        type='textarea'
        rows={3}
        label={t('common.description')}
        placeholder={t('tasks.descriptionPlaceholder')}
        value={description}
        onChangeText={setDescription}
        maxLength={2000}
      />

      <SelectField
        label={t('common.assignee')}
        value={assigneeId}
        placeholder={t('tasks.assigneePlaceholder')}
        options={assigneeOptions}
        onChange={setAssigneeId}
      />

      <HierarchyPicker value={hierarchy} onChange={setHierarchy} />

      <DateField label={t('common.deadline')} value={dueDate} onChange={setDueDate} />

      <Text variant='caption'>{t('tasks.createHint')}</Text>

      <Button onPress={submit} loading={saving} disabled={saving}>
        {t('common.create')}
      </Button>
    </ScrollView>
  );
}
