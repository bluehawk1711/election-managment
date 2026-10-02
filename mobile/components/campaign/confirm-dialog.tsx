import { AlertDialog } from '@/components/ui/alert-dialog';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

type Options = {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

/**
 * Promise-based confirmation. Render `dialog` once near the screen root:
 *
 * ```ts
 * const { confirm, dialog } = useConfirm();
 * if (await confirm({ title: t('common.deleteTitle', { name }) })) remove();
 * return <>{dialog}</>;
 * ```
 */
export function useConfirm() {
  const { t } = useTranslation();
  const [options, setOptions] = useState<Options | null>(null);
  const [resolveRef] = useState(() => ({ current: null as ((ok: boolean) => void) | null }));

  const confirm = useCallback(
    (opts: Options) => {
      setOptions(opts);
      return new Promise<boolean>((resolve) => {
        resolveRef.current = resolve;
      });
    },
    [resolveRef]
  );

  const finish = useCallback(
    (ok: boolean) => {
      setOptions(null);
      resolveRef.current?.(ok);
      resolveRef.current = null;
    },
    [resolveRef]
  );

  const dialog = (
    <AlertDialog
      isVisible={options != null}
      onClose={() => finish(false)}
      title={options?.title ?? ''}
      description={options?.body}
      confirmText={options?.confirmLabel ?? t('common.confirm')}
      cancelText={options?.cancelLabel ?? t('common.cancel')}
      onConfirm={() => finish(true)}
      onCancel={() => finish(false)}
      showCancelButton
    />
  );

  return { confirm, dialog };
}
