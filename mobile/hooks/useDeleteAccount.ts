import {
  deleteUser,
  EmailAuthProvider,
  reauthenticateWithCredential,
} from 'firebase/auth';
import { deleteObject, listAll, ref } from 'firebase/storage';
import { useCallback, useState } from 'react';
import { deleteDoc, getDocs } from '@/lib/db';
import { messageFor } from '@/lib/errors';
import { auth, storage } from '@/lib/firebase';

/**
 * Page size for the task sweep. No longer a hard cap — Firestore limited a
 * batch to 500 operations; here it just bounds one round trip's worth of
 * deletes so a big account does not fire thousands at once.
 */
const BATCH_LIMIT = 500;

/**
 * Deletes the signed-in user's data and then their account.
 *
 * **This is best-effort, and it is worth understanding why.** No backend used
 * here has `ON DELETE CASCADE`; nothing removes a user's data when their auth
 * record goes away. So this walks the data itself, in an order chosen so that a
 * failure part-way leaves the account usable rather than orphaned: tasks, then
 * the avatar, then the profile, and the auth record last. If the app is killed
 * mid-way the user still has an account and can try again — the reverse order
 * would leave data no one can ever reach or delete, because the rules key on a
 * uid that no longer exists.
 *
 * The robust version of this is server-side: Firebase's official "Delete User
 * Data" extension, or a Cloud Function on the `user.delete` trigger, both of
 * which run in one place with admin credentials. Neither ships here because
 * Cloud Functions require the paid Blaze plan and a starter should not.
 *
 * **Known limitation, inherited not introduced.** `users/{uid}`'s delete rule
 * requires `auth.uid !== $uid`, so an owner cannot delete their OWN profile —
 * it is a deliberate lockout guard, carried over verbatim from
 * `firestore.rules`, and the profile step below therefore fails and aborts the
 * deletion before the auth record is touched. Making "delete my account" work
 * needs a rules decision (allow an owner to delete exactly their own node), not
 * a client change.
 *
 * `deleteUser` throws `auth/requires-recent-login` unless the user signed in
 * within the last few minutes, which is what the `password` argument is for.
 * Federated users (Google, Apple) reauthenticate through their provider
 * instead — the dialog picks the right path from `providerData`.
 */
export function useDeleteAccount() {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deleteAccount = useCallback(
    async (password?: string): Promise<boolean> => {
      const user = auth.currentUser;
      if (!user) return false;

      setDeleting(true);
      setError(null);

      try {
        // Reauthenticate first: doing the data teardown and only then finding
        // out the account cannot be deleted is the worst of both worlds.
        if (password && user.email) {
          await reauthenticateWithCredential(
            user,
            EmailAuthProvider.credential(user.email, password)
          );
        }

        await deleteTasks(user.uid);
        await deleteAvatars(user.uid);
        await deleteDoc(`users/${user.uid}`);

        // Last. Once this succeeds the rules no longer match anything above.
        await deleteUser(user);
        return true;
      } catch (caught) {
        setError(messageFor(caught));
        return false;
      } finally {
        setDeleting(false);
      }
    },
    []
  );

  return { deleteAccount, deleting, error };
}

/** Deletes every task the user owns, a page at a time. */
async function deleteTasks(uid: string): Promise<void> {
  for (;;) {
    const rows = await getDocs('tasks', {
      where: { field: 'ownerId', value: uid },
      limit: BATCH_LIMIT,
    });

    if (rows.length === 0) return;

    // RTDB has no `writeBatch`, and a multi-path `update()` of nulls would need
    // a helper `lib/db` does not expose. `Promise.all` over one page is the
    // honest equivalent: bounded concurrency, and a rejected delete rejects the
    // page, which the caller reports rather than silently skipping.
    await Promise.all(rows.map((row) => deleteDoc(`tasks/${row.id}`)));

    // A short page means that was the last one. Checking here rather than
    // looping again saves a final empty read.
    if (rows.length < BATCH_LIMIT) return;
  }
}

/**
 * Deletes the user's avatar objects.
 *
 * `listAll` rather than a known filename: the extension depends on what they
 * uploaded, and a leftover `avatar.png` beside a newer `avatar.jpg` would
 * survive a targeted delete.
 */
async function deleteAvatars(uid: string): Promise<void> {
  try {
    const listing = await listAll(ref(storage, `avatars/${uid}`));
    await Promise.all(listing.items.map((item) => deleteObject(item)));
  } catch {
    // No avatar was ever uploaded, most likely. Not worth failing a deletion
    // over — the account and its documents still go.
  }
}
