import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabaseWithUrl } from 'firebase-admin/database';

const UID = 'o8yLbaNzSYd3UdjffYRAxuwe1nv1';
const app = initializeApp({
  credential: applicationDefault(),
  projectId: 'election-managment',
});
const auth = getAuth(app);
const rtdb = getDatabaseWithUrl(
  'https://election-managment-default-rtdb.asia-southeast1.firebasedatabase.app',
  app
);

if (process.argv[2] === 'delete') {
  await auth.deleteUser(UID);
  await rtdb.ref(`users/${UID}`).remove();
  console.log('deleted');
} else {
  await rtdb.ref(`users/${UID}`).update({
    multiDevice: true,
    locked: null,
    lockedReason: null,
    lockedAt: null,
    lockedBy: null,
    device: null,
    updatedAt: Date.now(),
  });
  console.log('reset + multiDevice');
}

process.exit(0);
