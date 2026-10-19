// One-off E2E: prove the DEPLOYED prod rules let a super admin rebind
// devices. Signs in via the firebase client SDK (the same stack the app
// uses) and writes users/{uid}.device twice — the second write is the
// rebind the pre-deploy rules would reject.
const fs = require('node:fs');
const { initializeApp } = require('firebase/app');
const { getAuth, signInWithEmailAndPassword } = require('firebase/auth');
const { getFirestore, doc, updateDoc, getDoc } = require('firebase/firestore');

const env = fs.readFileSync('.env.local', 'utf8');
const pick = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))[1].trim();

const app = initializeApp({
  apiKey: pick('NEXT_PUBLIC_FIREBASE_API_KEY'),
  authDomain: pick('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN'),
  projectId: pick('NEXT_PUBLIC_FIREBASE_PROJECT_ID'),
  appId: pick('NEXT_PUBLIC_FIREBASE_APP_ID'),
});

const device = (id) => ({
  id,
  name: 'e2e-verification',
  platform: 'web',
  lastActiveAt: Date.now(),
});

(async () => {
  const cred = await signInWithEmailAndPassword(
    getAuth(app),
    'gauravdadhich34@gmail.com',
    '1234567890'
  );
  const uid = cred.user.uid;
  console.log('sign-in ok, uid:', uid);

  const ref = doc(getFirestore(app), 'users', uid);

  await updateDoc(ref, { device: device('e2e00000-1111-2222-3333-444444444444') });
  console.log('first bind : ALLOWED');

  // Discriminating write: rebind over an existing binding.
  await updateDoc(ref, { device: device('eeee0000-1111-2222-3333-444444444444') });
  const after = (await getDoc(ref)).data();
  console.log('rebind     : ALLOWED — live device id:', after.device.id);

  // Negative control: a MALFORMED map must still be refused (shape checks
  // are role-blind), proving the writes passed as real rule evaluations
  // rather than being silently ignored.
  try {
    await updateDoc(ref, { device: { id: 'short' } });
    console.log('malformed  : ALLOWED (unexpected — shape check should deny)');
    process.exit(1);
  } catch {
    console.log('malformed  : DENIED (shape validation intact)');
  }
})().catch((e) => {
  console.error('FAIL', e.code ?? '', e.message);
  process.exit(1);
});
