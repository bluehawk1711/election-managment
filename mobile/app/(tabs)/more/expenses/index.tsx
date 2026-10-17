import { Chip } from '@/components/campaign/chip';
import { EmptyState } from '@/components/campaign/empty-state';
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
import { useExpenses } from '@/hooks/useExpenses';
import { formatCompactCurrency } from '@/lib/format';
import type { ExpenseCategory, ExpenseStatus } from '@/lib/models';
import { useRouter } from 'expo-router';
import { Plus, Receipt } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const EXPENSE_CAT_KEY: Record<ExpenseCategory, TranslationKey> = {
  travel: 'expenses.cat.travel',
  fuel: 'expenses.cat.fuel',
  materials: 'expenses.cat.materials',
  printing: 'expenses.cat.printing',
  food: 'expenses.cat.food',
  venue: 'expenses.cat.venue',
  other: 'expenses.cat.other',
};

const STATUS_KEY: Record<ExpenseStatus, TranslationKey> = {
  pending: 'status.pending',
  approved: 'status.approved',
  rejected: 'status.rejected',
};

const STATUS_TONE: Record<ExpenseStatus, 'warning' | 'success' | 'danger'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
};

/**
 * Expenses — the campaign's audit trail, newest first.
 *
 * Leads with the total: the number the dashboard's expenses tile promises is
 * "how much have we spent", and this screen is where that question lands.
 * Approval stays out of this list for now (the statuses are stored and
 * shown; changing them is the super admin's console work) — the screen's job
 * is the record, not the workflow.
 */
export default function ExpensesScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const { expenses, loading, error, retry } = useExpenses();

  const [query, setQuery] = useState('');

  useEffect(() => {
    if (error) toast.error(t('common.errorTitle'), error);
  }, [error, toast, t]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return expenses
      .filter((expense) =>
        needle
          ? expense.description.toLowerCase().includes(needle) ||
            t(EXPENSE_CAT_KEY[expense.category]).toLowerCase().includes(needle)
          : true
      )
      .sort((a, b) => b.date - a.date);
  }, [expenses, query, t]);

  const total = useMemo(
    () => filtered.reduce((sum, expense) => sum + expense.amount, 0),
    [filtered]
  );

  const emptyFiltered = !loading && filtered.length === 0 && expenses.length > 0;
  const emptyAll = !loading && expenses.length === 0;

  const dateLabel = (date: number) =>
    new Date(date).toLocaleDateString(i18n.language === 'hi' ? 'hi-IN' : 'en-IN');

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: 112, gap: 12 }}
      keyboardShouldPersistTaps='handled'
    >
      <Card style={{ gap: 4 }}>
        <Text variant='caption'>{t('expenses.totalLabel')}</Text>
        <Text variant='heading'>{formatCompactCurrency(total, i18n.language)}</Text>
        <Text variant='caption'>{t('common.items', { count: filtered.length })}</Text>
      </Card>

      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <SearchInput value={query} onChangeText={setQuery} />
        </View>
        <Button
          size='icon'
          onPress={() => router.push('/(tabs)/more/expenses/new')}
          accessibilityLabel={t('expenses.create')}
        >
          <Plus size={20} />
        </Button>
      </View>

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
          icon={Receipt}
          title={t('common.empty')}
          body={t('expenses.emptyBody')}
          actionLabel={t('expenses.create')}
          onAction={() => router.push('/(tabs)/more/expenses/new')}
        />
      ) : emptyFiltered ? (
        <EmptyState
          icon={Receipt}
          title={t('expenses.noMatches')}
          body={t('expenses.noMatchesBody')}
        />
      ) : (
        <View style={{ gap: 8 }}>
          {filtered.map((expense) => (
            <ListRow
              key={expense.id}
              title={formatCompactCurrency(expense.amount, i18n.language)}
              subtitle={t(EXPENSE_CAT_KEY[expense.category])}
              meta={dateLabel(expense.date)}
              icon={Receipt}
              tone='info'
              trailing={
                <Chip
                  label={t(STATUS_KEY[expense.status] as TranslationKey)}
                  tone={STATUS_TONE[expense.status]}
                />
              }
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}
