import { SelectField } from '@/components/campaign/select-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollView } from '@/components/ui/scroll-view';
import { Text } from '@/components/ui/text';
import { useAction } from '@/hooks/useAction';
import { useIssues } from '@/hooks/useIssues';
import { ISSUE_CATEGORIES, type IssueCategory } from '@/lib/models';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Report-issue modal — title required, everything else optional per rules.
 *
 * Mirrors `more/tasks/new` on purpose: the two forms are the same gesture
 * (say what is wrong, file it), and a karykarta should not have to learn a
 * second layout for the half of the pair they use while standing on a road.
 */
export default function NewIssueScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const run = useAction();
  const { create } = useIssues();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<IssueCategory>('road');
  const [showError, setShowError] = useState(false);
  const [saving, setSaving] = useState(false);

  const trimmedTitle = title.trim();

  const categoryOptions = ISSUE_CATEGORIES.map((value) => ({
    value,
    label: t(`issues.cat.${value}` as const),
  }));

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
          category,
          areaId: '',
          photoUrl: '',
          status: 'open',
        }),
      { success: t('issues.createdToast') }
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
        placeholder={t('issues.titlePlaceholder')}
        value={title}
        onChangeText={(next) => {
          setTitle(next);
          if (showError) setShowError(false);
        }}
        error={showError && !trimmedTitle ? t('issues.titleRequired') : undefined}
        maxLength={200}
        autoFocus
      />

      <Input
        type='textarea'
        rows={3}
        label={t('common.description')}
        placeholder={t('issues.descriptionPlaceholder')}
        value={description}
        onChangeText={setDescription}
        maxLength={2000}
      />

      <SelectField
        label={t('common.category')}
        value={category}
        placeholder={t('common.category')}
        options={categoryOptions}
        onChange={(value) => setCategory(value as IssueCategory)}
      />

      <Button onPress={submit} loading={saving} disabled={saving}>
        {t('common.create')}
      </Button>
    </ScrollView>
  );
}
