import { messageFor } from '@/lib/errors';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/ui/toast';

/**
 * The one way every screen runs a Firestore write.
 *
 * Catches, translates the Firebase error code to prose and shows it; on
 * success shows the caller's toast. Returns a boolean so a form can stay open
 * when the write failed and close only on success.
 */
export function useAction(): (
  action: () => Promise<unknown>,
  options?: { success?: string }
) => Promise<boolean> {
  const toast = useToast();
  const { t } = useTranslation();

  return useCallback(
    async (action: () => Promise<unknown>, options?: { success?: string }) => {
      try {
        await action();
        if (options?.success) {
          toast.success(options.success);
        }
        return true;
      } catch (caught) {
        toast.error(t('common.errorTitle'), messageFor(caught));
        return false;
      }
    },
    [toast, t]
  );
}
