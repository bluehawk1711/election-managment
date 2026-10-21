// Read-only inventory of the Firestore collections we need to seed.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';

const sa = JSON.parse(readFileSync(new URL('../service-account.json', import.meta.url), 'utf8'));
const app = getApps().length ? getApps()[0] : initializeApp({ credential: cert(sa), projectId: sa.project_id });
// The project's Firestore database is named `default`, not `(default)`.
const db = getFirestore(app, 'default');

const COLLECTIONS = [
  'voters', 'wards', 'users', 'tasks', 'issues', 'events', 'expenses',
  'compliance', 'constituencies', 'areas', 'booths', 'teamMembers',
  'voterPhones', 'teams', 'campaigns',
];

for (const name of COLLECTIONS) {
  const snap = await db.collection(name).limit(2).get();
  const total = await db.collection(name).count().get();
  console.log(`${name.padEnd(18)} count=${String(total.data().count).padStart(6)}`);
  for (const doc of snap.docs) {
    console.log(`   ${doc.id} :: ${JSON.stringify(doc.data()).slice(0, 260)}`);
  }
}

const cfg = await db.doc('appConfig/general').get();
console.log(`appConfig/general   ${cfg.exists ? JSON.stringify(cfg.data()) : 'ABSENT'}`);
