import { DateField } from '@/components/campaign/date-field';
import { SelectField } from '@/components/campaign/select-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollView } from '@/components/ui/scroll-view';
import { useAction } from '@/hooks/useAction';
import { useExpenses } from '@/hooks/useExpenses';
import { EXPENSE_CATEGORIES, type ExpenseCategory } from '@/lib/models';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Add-expense modal — amount required, the rest optional.
 *
 * The amount is parsed with `parseFloat` and kept as a number from the
 * moment it is typed: the dashboard tile sums this collection, and a string
 * that only becomes a number at aggregation time is how "₹1,000 + ₹50" ends
 * up as "₹1,00050" somewhere upstream. Date defaults to today — most
 * expenses are logged the day they happen, and the picker is one tap away
 * for the ones that are not.
 */
export default function NewExpenseScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const run = useAction();
  const { create } = useExpenses();

  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('travel');
  const [date, setDate] = useState<number | null>(() => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    return today.getTime();
  });
  const [showError, setShowError] = useState(false);
  const [saving, setSaving] = useState(false);

  const parsedAmount = Number.parseFloat(amount);
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount > 0;

  const categoryOptions = EXPENSE_CATEGORIES.map((value) => ({
    value,
    label: t(`expenses.cat.${value}` as const),
  }));

  const submit = async () => {
    if (!amountValid || date == null) {
      setShowError(true);
      return;
    }
    setSaving(true);
    const ok = await run(
      () =>
        create({
          amount: Math.round(parsedAmount * 100) / 100,
          description: description.trim(),
          category,
          date,
          receiptUrl: '',
        }),
      { success: t('expenses.createdToast') }
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
        label={t('expenses.amount')}
        placeholder={t('expenses.amountPlaceholder')}
        value={amount}
        onChangeText={(next) => {
          setAmount(next);
          if (showError) setShowError(false);
        }}
        error={showError && !amountValid ? t('expenses.amountRequired') : undefined}
        keyboardType='decimal-pad'
        autoFocus
      />

      <SelectField
        label={t('common.category')}
        value={category}
        placeholder={t('common.category')}
        options={categoryOptions}
        onChange={(value) => setCategory(value as ExpenseCategory)}
      />

      <Input
        label={t('common.description')}
        placeholder={t('expenses.descriptionPlaceholder')}
        value={description}
        onChangeText={setDescription}
        maxLength={500}
      />

      <DateField label={t('expenses.date')} value={date} onChange={setDate} />

      <Button onPress={submit} loading={saving} disabled={saving}>
        {t('common.create')}
      </Button>
    </ScrollView>
  );
}
