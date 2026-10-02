import { Badge } from '@/components/ui/badge';
import type { TranslationKey } from '@/i18n/locales/en';
import { useTranslation } from 'react-i18next';
import type {
  ComplianceStatus,
  ExpenseStatus,
  IssueStatus,
  TaskStatus,
  TeamStatus,
} from '@/lib/models';

export type AnyStatus =
  | TaskStatus
  | IssueStatus
  | ExpenseStatus
  | ComplianceStatus
  | TeamStatus;

type Variant = 'default' | 'secondary' | 'destructive' | 'outline' | 'success';

const VARIANT: Record<AnyStatus, Variant> = {
  pending: 'outline',
  in_progress: 'default',
  completed: 'success',
  issue: 'destructive',
  open: 'outline',
  resolved: 'success',
  approved: 'success',
  rejected: 'destructive',
  done: 'success',
  attention: 'destructive',
  active: 'success',
  inactive: 'secondary',
};

const KEY: Record<AnyStatus, string> = {
  pending: 'status.pending',
  in_progress: 'status.inProgress',
  completed: 'status.completed',
  issue: 'status.issue',
  open: 'status.open',
  resolved: 'status.resolved',
  approved: 'status.approved',
  rejected: 'status.rejected',
  done: 'status.done',
  attention: 'status.attention',
  active: 'status.active',
  inactive: 'status.inactive',
};

/** Badge with the translated label for any closed-vocabulary status. */
export function StatusBadge({ status }: { status: AnyStatus }) {
  const { t } = useTranslation();
  return <Badge variant={VARIANT[status]}>{t(KEY[status] as TranslationKey)}</Badge>;
}
