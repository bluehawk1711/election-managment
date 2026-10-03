import { daysBetween, startOfDay } from '@/lib/dates';
import type { TFunction } from 'i18next';
import { formatDate } from '@/lib/format';

type Translate = TFunction;

export type DueInfo = { text: string; overdue: boolean };

/** Human due-date label with an overdue flag (list rows + detail). */
export function dueLabel(
  dueDate: number | null,
  now: number,
  t: Translate,
  lang?: string | null
): DueInfo {
  if (dueDate == null) return { text: t('common.none'), overdue: false };
  const today = startOfDay(now);
  const days = daysBetween(today, dueDate);
  if (days < 0) return { text: t('tasks.dueOverdue'), overdue: true };
  if (days === 0) return { text: t('common.today'), overdue: false };
  if (days === 1) return { text: t('common.tomorrow'), overdue: false };
  return { text: formatDate(dueDate, lang), overdue: false };
}
