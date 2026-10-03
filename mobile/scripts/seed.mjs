#!/usr/bin/env node
/**
 * Seeds the REAL Firestore project with one demo campaign.
 *
 *     npm run seed              # refuses if any campaign collection has data
 *     npm run seed -- --force   # clears the campaign collections first
 *
 * Credentials come from Application Default Credentials — in practice the
 * `GOOGLE_APPLICATION_CREDENTIALS` environment variable pointing at a service
 * account JSON with Firestore write access:
 *
 *     $env:GOOGLE_APPLICATION_CREDENTIALS = "D:\secrets\svc.json"
 *
 * The project id resolves in this order: `--project`, the
 * `EXPO_PUBLIC_FIREBASE_PROJECT_ID` variable, the same key inside
 * `.env.local`/`.env`, then `.firebaserc`.
 *
 * Writes land in the `default` database — see `FIRESTORE_DATABASE_ID` below.
 *
 * Admin SDK on purpose: the seed writes hundreds of documents and bypasses
 * firestore.rules (server-side validation is for clients; the data written
 * here matches the rules exactly anyway — same key sets, same vocabularies).
 *
 * `users/{uid}` is never touched. Sign-up in the app creates those.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '..');

// ---------------------------------------------------------------------------
// Arguments and project resolution
// ---------------------------------------------------------------------------

const force = process.argv.includes('--force');
const projectFlagIndex = process.argv.indexOf('--project');
const projectFlag = projectFlagIndex === -1 ? null : process.argv[projectFlagIndex + 1];

/** Reads KEY=value lines out of a dotenv file, ignoring comments. */
function readEnvFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
    if (match) out[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const dotEnv = {
  ...readEnvFile(path.join(ROOT, '.env')),
  ...readEnvFile(path.join(ROOT, '.env.local')),
};

function resolveProjectId() {
  const candidates = [
    projectFlag,
    process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    dotEnv.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  ];
  const fromEnv = candidates.find((value) => value && value.trim());
  if (fromEnv) return fromEnv.trim();

  const firebaserc = path.join(ROOT, '.firebaserc');
  if (existsSync(firebaserc)) {
    try {
      const id = JSON.parse(readFileSync(firebaserc, 'utf8')).projects?.default;
      if (id && id !== 'your-project-id') return id;
    } catch {
      // Fall through to the friendly error below.
    }
  }
  return null;
}

const projectId = resolveProjectId();

if (!projectId) {
  console.error(
    '✖ No project id.\n' +
      '  Pass one:   npm run seed -- --project <id>\n' +
      '  Or set EXPO_PUBLIC_FIREBASE_PROJECT_ID in .env.local,\n' +
      "  or replace the placeholder in .firebaserc.\n"
  );
  process.exit(1);
}

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error(
    '✖ GOOGLE_APPLICATION_CREDENTIALS is not set.\n' +
      '  Point it at a service-account JSON with Firestore write access:\n\n' +
      '    $env:GOOGLE_APPLICATION_CREDENTIALS = "D:\\secrets\\svc.json"\n\n' +
      '  (Google Cloud Console → IAM → Service Accounts → Keys.)\n'
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Campaign content — placeholders, matching the app's generic branding.
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const today = (() => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
})();

// Deterministic pseudo-randomness: two runs of the seed produce the same
// campaign, which makes "it looked different yesterday" debuggable.
let seedState = 20270214;
const rand = () => {
  seedState = (seedState * 1664525 + 1013904223) >>> 0;
  return seedState / 2 ** 32;
};
const pick = (items) => items[Math.floor(rand() * items.length)];
const intBetween = (min, max) => min + Math.floor(rand() * (max - min + 1));
const chance = (percentTrue) => intBetween(1, 100) <= percentTrue;

const slug = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

const WARDS = [
  { name: 'Ratanada', areas: ['Gandhi Nagar', 'Ratanada Chowk', 'Collectorate'] },
  { name: 'Sardarpura', areas: ['Sector 3', 'Sardarpura Bazaar', 'Jawahar Nagar'] },
  { name: 'Bhagat ki Kothi', areas: ['Transport Nagar', 'Saraswati Nagar', 'Cantt'] },
  { name: 'Paota', areas: ['Paota B Road', 'Neemra', 'Rampura'] },
];

const CONSTITUENCY = { id: 'cons-jodhpur', name: 'Jodhpur', code: 'RJ-11' };

const BOOTH_PLACES = [
  'Govt Upper Primary School',
  'Government School',
  'Anganwadi Centre',
  'Community Hall',
];

const FIRST_NAMES = [
  'Sunita', 'Kamla', 'Rekha', 'Anita', 'Pooja', 'Meena', 'Sarita', 'Nirmala',
  'Ramesh', 'Suresh', 'Mahesh', 'Dinesh', 'Vikram', 'Arjun', 'Prakash', 'Rakesh',
  'Geeta', 'Suman', 'Kavita', 'Anjali',
];
const LAST_NAMES = [
  'Devi', 'Sharma', 'Mehta', 'Choudhary', 'Joshi', 'Vyas', 'Bhandari', 'Solanki',
  'Rathore', 'Tanwar', 'Purohit', 'Gurjar',
];

const TEAM = [
  { name: 'Ravi Mehta', role: 'coordinator', wardIndex: 0 },
  { name: 'Sunita Rathore', role: 'coordinator', wardIndex: 1 },
  { name: 'Imran Qureshi', role: 'coordinator', wardIndex: 2 },
  { name: 'Pooja Bhandari', role: 'coordinator', wardIndex: 3 },
  { name: 'Dinesh Tanwar', role: 'worker', wardIndex: 0 },
  { name: 'Kavita Joshi', role: 'worker', wardIndex: 1 },
  { name: 'Arjun Vyas', role: 'worker', wardIndex: 1 },
  { name: 'Meena Solanki', role: 'worker', wardIndex: 2 },
  { name: 'Rakesh Gurjar', role: 'worker', wardIndex: 2 },
  { name: 'Nirmala Purohit', role: 'worker', wardIndex: 3 },
];

const TASK_CONTENT = [
  ['Door-to-door survey of lane 4', 'Note every household concern in the app as you walk.'],
  ['Verify polling agents for the north booths', 'Names must reach the RO office before the deadline.'],
  ['Hang banners at the market crossing', 'Two volunteers, ladder, cable ties.'],
  ['Follow up on the drainage complaint', 'Photograph the current state for the issue thread.'],
  ['Youth meeting at the community hall', 'Short session: volunteers, registration, next steps.'],
  ['Update the voter list notes for booth 118', 'Only factual fields — no preferences, ever.'],
  ['Distribute the rally schedule', 'Ward WhatsApp groups plus printed flyers.'],
  ['Confirm sound-system permission', 'City permission desk, copy of the application.'],
  ['Coordinate the rickshaw rally route', 'Keep the loop inside the ward boundaries.'],
  ['Call every volunteer who missed two sessions', 'Log the outcome as a task report.'],
  ['Photograph the repaired streetlight', 'Attach proof before closing the issue.'],
  ['Brief the new booth coordinators', 'Walk them through the app and the rules of conduct.'],
  ['Collect signed support forms', 'Store them at the campaign office, not on phones.'],
  ['Check water supply at the relief camp', 'Residents reported the tank has been dry since Tuesday.'],
  ['Reconcile this week\'s travel claims', 'Receipts must match amounts to the rupee.'],
  ['Walk the boundary of the ward with the map', 'Flag any lane missing from the area list.'],
  ['Prepare the morning stand-up notes', 'Three lines: done, doing, blocked.'],
  ['Restock flyer stock at the office', 'Two thousand copies, both languages.'],
];

const TASK_STATUS_CYCLE = [
  'completed', 'in_progress', 'pending', 'completed', 'pending', 'issue',
  'completed', 'in_progress', 'pending', 'completed', 'pending', 'in_progress',
  'completed', 'pending', 'issue', 'pending', 'in_progress', 'completed',
];

const ISSUE_CONTENT = [
  ['road', 'Broken pavement near the chowk', 'Two-wheelers swerve into traffic avoiding the potholes.'],
  ['water', 'Street tap running dry since Tuesday', 'Three households are fetching water from the next lane.'],
  ['electricity', 'Streetlight out on the market road', 'The stretch is pitch dark after 8 pm.'],
  ['drainage', 'Drain overflow after the last rain', 'Standing water at the corner where children walk.'],
  ['streetlight', 'Flickering light outside the school', 'The pole buzzes and cuts out every few minutes.'],
  ['sanitation', 'Garbage skipped for four days', 'Bins are overflowing near the bus stop.'],
  ['road', 'Loose manhole cover on Station Road', 'Cars drop into it at speed — somebody will get hurt.'],
  ['water', 'Leaking pipeline near Sector 3 park', 'Water runs down the footpath all day.'],
  ['drainage', 'Blocked storm drain behind the bazaar', 'The lane floods at the first shower.'],
  ['electricity', 'Low-hanging wire near the Anganwadi', 'It dips to head height where children pass.'],
];

const EVENT_CONTENT = [
  { title: 'Ward volunteer stand-up', type: 'meeting', offset: -7, hour: 10, duration: 1 },
  { title: 'App training for new coordinators', type: 'training', offset: -4, hour: 17, duration: 2 },
  { title: 'Market corner public meeting', type: 'public', offset: -2, hour: 18, duration: 1 },
  { title: 'Ward-level review with booth leads', type: 'meeting', offset: 1, hour: 11, duration: 1 },
  { title: 'Nomination paper filing window', type: 'deadline', offset: 3, hour: 10, duration: 0 },
  { title: 'Volunteer door-knock sprint', type: 'training', offset: 5, hour: 9, duration: 3 },
  { title: 'Residents’ grievances open house', type: 'public', offset: 7, hour: 17, duration: 2 },
  { title: 'Youth wing planning meeting', type: 'meeting', offset: 9, hour: 16, duration: 1 },
  { title: 'Agent briefing before polling day', type: 'training', offset: 12, hour: 10, duration: 2 },
  { title: 'Final route rehearsal for the rally', type: 'public', offset: 15, hour: 8, duration: 2 },
  { title: 'Campaign accounts closure', type: 'deadline', offset: 18, hour: 18, duration: 0 },
  { title: 'Polling-day coordination call', type: 'meeting', offset: 21, hour: 7, duration: 1 },
];

const EXPENSE_CONTENT = [
  ['travel', 'Auto to the Ratanada rally point', 420, 'approved'],
  ['fuel', 'Campaign vehicle fuel — week 1', 3100, 'approved'],
  ['printing', 'Five thousand bilingual flyers', 7800, 'approved'],
  ['food', 'Volunteer lunch, community hall', 2450, 'approved'],
  ['materials', 'Banner cloth and cable ties', 1600, 'pending'],
  ['venue', 'Community hall rental, two evenings', 5000, 'pending'],
  ['travel', 'Auto to the RO office', 260, 'approved'],
  ['other', 'Marker pens and clipboards', 340, 'approved'],
  ['fuel', 'Two-wheeler fuel — survey round', 900, 'pending'],
  ['printing', 'Rally placards, hundred pieces', 4300, 'approved'],
  ['food', 'Tea for the booth coordinators meet', 780, 'rejected'],
  ['materials', 'Flex sheets for stage backdrop', 6200, 'pending'],
  ['travel', 'Tempo for sound equipment', 1800, 'approved'],
  ['other', 'Photocopies of support forms', 650, 'approved'],
];

const COMPLIANCE_CONTENT = [
  ['File the monthly expenditure statement', 'expenditure', 'pending', 6,
    'RO portal, before the 10th of next month.'],
  ['Assemble proof of nomination papers', 'nomination', 'attention', 2,
    'Two proposers per page, signatures witnessed.'],
  ['Confirm booth allocation letter received', 'permissions', 'done', -3,
    'Hard copy filed at the campaign office.'],
  ['Brief agents on counting-day conduct', 'conduct', 'pending', 14,
    'One page each, signed acknowledgement.'],
  ['Update the donor disclosure register', 'disclosure', 'attention', 1,
    'Anything above the threshold must be entered same-day.'],
  ['Submit the candidate affidavit to the RO', 'nomination', 'done', -9,
    'Acknowledgement receipt scanned and filed.'],
  ['Renew the rally sound-system permission', 'permissions', 'pending', 4,
    'Applies to the 9 am–10 pm window only.'],
  ['Archive travel bills for the audit sample', 'expenditure', 'pending', 10,
    'Chronological, receipts stapled to claims.'],
];

// ---------------------------------------------------------------------------
// Build the campaign in memory, then write it in one pass.
// ---------------------------------------------------------------------------

function buildCampaign() {
  const constituencies = [CONSTITUENCY];

  const wards = WARDS.map((ward) => ({
    id: `ward-${slug(ward.name)}`,
    data: { name: ward.name, constituencyId: CONSTITUENCY.id },
  }));

  const areas = [];
  for (const ward of WARDS) {
    for (const areaName of ward.areas) {
      areas.push({
        id: `area-${slug(areaName)}`,
        data: {
          name: areaName,
          wardId: `ward-${slug(ward.name)}`,
          constituencyId: CONSTITUENCY.id,
        },
      });
    }
  }

  // Three booths per area, numbered 101 upward.
  const booths = [];
  let boothNumber = 101;
  for (const area of areas) {
    const ward = WARDS.find((w) => `ward-${slug(w.name)}` === area.data.wardId);
    for (let i = 0; i < 3; i += 1) {
      booths.push({
        id: `booth-${boothNumber}`,
        data: {
          number: boothNumber,
          name: pick(BOOTH_PLACES),
          address: `${area.data.name} ${pick(['Main Road', 'Lane 2', 'Cross Road', 'Bazaar Lane'])}`,
          areaId: area.id,
          wardId: ward ? `ward-${slug(ward.name)}` : '',
          constituencyId: CONSTITUENCY.id,
          estimatedVoters: intBetween(620, 1150),
          coordinatorId: '', // staffed below, once the roster exists
        },
      });
      boothNumber += 1;
    }
  }

  const team = TEAM.map((member, index) => {
    const ward = WARDS[member.wardIndex];
    const homeAreaId = `area-${slug(ward.areas[0])}`;
    return {
      id: `member-${String(index + 1).padStart(2, '0')}`,
      data: {
        name: member.name,
        phone: `9${intBetween(100000000, 999999999)}`,
        role: member.role,
        status: index === 9 ? 'inactive' : 'active',
        areaId: homeAreaId,
        boothId: '',
      },
    };
  });

  // Staff ~70% of booths, ward by ward, so the coverage rails vary and
  // "needs attention" has real rows to show.
  const membersByWard = WARDS.map((ward, wardIndex) =>
    team.filter((_, memberIndex) => TEAM[memberIndex].wardIndex === wardIndex)
  );
  booths.forEach((booth) => {
    const wardIndex = Math.floor(
      areas.findIndex((area) => area.id === booth.data.areaId) / 3
    );
    const wardMembers = membersByWard[wardIndex] ?? team;
    if (chance(70)) {
      booth.data.coordinatorId = pick(wardMembers).id;
    }
  });

  // Voters: 8–15 per booth, all eligible, no political fields anywhere.
  const voters = [];
  for (const booth of booths) {
    const count = intBetween(8, 15);
    for (let i = 1; i <= count; i += 1) {
      const female = chance(52);
      const otherGender = chance(3);
      voters.push({
        data: {
          rollId: `RJ${CONSTITUENCY.code.slice(3)}-${booth.data.number}-${String(i).padStart(3, '0')}`,
          name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
          gender: otherGender ? 'other' : female ? 'female' : 'male',
          age: intBetween(18, 84),
          houseNo: String(intBetween(1, 240)),
          mobile: chance(75) ? `9${intBetween(100000000, 999999999)}` : '',
          boothId: booth.id,
          areaId: booth.data.areaId,
          wardId: booth.data.wardId,
          constituencyId: CONSTITUENCY.id,
        },
      });
    }
  }

  const activeMembers = team.filter((member) => member.data.status === 'active');

  const tasks = TASK_CONTENT.map(([title, description], index) => {
    const area = pick(areas);
    const areaBooths = booths.filter((booth) => booth.data.areaId === area.id);
    const assignee = pick(activeMembers);
    return {
      data: {
        title,
        description,
        assigneeId: chance(85) ? assignee.id : '',
        areaId: chance(80) ? area.id : '',
        boothId: chance(35) ? pick(areaBooths).id : '',
        dueDate: today + intBetween(-4, 12) * DAY,
        status: TASK_STATUS_CYCLE[index],
        report:
          TASK_STATUS_CYCLE[index] === 'completed'
            ? 'Done — notes filed against the area.'
            : '',
        createdBy: pick(activeMembers).data.name,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
    };
  });

  const issues = ISSUE_CONTENT.map(([category, title, description], index) => ({
    data: {
      category,
      title,
      description,
      areaId: pick(areas).id,
      photoUrl: '',
      status: index < 5 ? 'open' : index < 8 ? 'in_progress' : 'resolved',
      reportedBy: chance(50) ? pick(activeMembers).data.name : 'Ward resident',
      reportedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
  }));

  const events = EVENT_CONTENT.map((event) => {
    const startsAt = today + event.offset * DAY + event.hour * 3_600_000;
    return {
      data: {
        title: event.title,
        type: event.type,
        startsAt,
        endsAt: event.duration ? startsAt + event.duration * 3_600_000 : null,
        location: pick(['Campaign office', 'Ward community hall', 'Market crossing', 'Sector 3 park']),
        description: '',
        createdAt: FieldValue.serverTimestamp(),
      },
    };
  });

  const expenses = EXPENSE_CONTENT.map(([category, description, amount, status]) => ({
    data: {
      date: today - intBetween(0, 21) * DAY,
      category,
      amount,
      description,
      receiptUrl: '',
      status,
      createdBy: pick(activeMembers).data.name,
      createdAt: FieldValue.serverTimestamp(),
    },
  }));

  const compliance = COMPLIANCE_CONTENT.map(([title, category, status, offset, notes]) => ({
    data: {
      title,
      category,
      status,
      dueDate: today + offset * DAY,
      notes,
      updatedAt: FieldValue.serverTimestamp(),
    },
  }));

  const campaign = {
    data: {
      name: 'Jodhpur Ward Campaign',
      candidateName: 'Meera Sharma',
      constituencyName: CONSTITUENCY.name,
      electionDate: today + 96 * DAY,
      tagline: 'Door to door, ward by ward',
      startDate: today - 45 * DAY,
      updatedAt: FieldValue.serverTimestamp(),
    },
  };

  return { campaign, constituencies, wards, areas, booths, voters, team, tasks, issues, events, expenses, compliance };
}

const COLLECTION_NAMES = [
  'campaigns', 'constituencies', 'wards', 'areas', 'booths', 'voters',
  'teamMembers', 'tasks', 'issues', 'events', 'expenses', 'compliance',
];

// ---------------------------------------------------------------------------
// Write it
// ---------------------------------------------------------------------------

/**
 * The database id is `default`, not `(default)`.
 *
 * `getFirestore()` with no arguments resolves to `'(default)'`, which does not
 * exist in this project — it was provisioned as ENTERPRISE with an explicitly
 * named database (see `firebase.json`, `"database": "default"`). Reads there
 * come back `5 NOT_FOUND: no such database`. `FIRESTORE_DATABASE_ID` in
 * `lib/firebase.ts` is the client-side twin of this constant; keep the two in
 * step.
 */
const FIRESTORE_DATABASE_ID = 'default';

async function main() {
  initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore(FIRESTORE_DATABASE_ID);

  // 1. Refuse to touch non-empty data without --force.
  const nonEmpty = [];
  for (const name of COLLECTION_NAMES) {
    const snapshot = await db.collection(name).limit(1).get();
    if (!snapshot.empty) nonEmpty.push(name);
  }
  if (nonEmpty.length && !force) {
    console.error(
      `✖ Project "${projectId}" already has data in: ${nonEmpty.join(', ')}.\n` +
        '  Re-run with --force to clear those collections and reseed:\n\n' +
        '    npm run seed -- --force\n'
    );
    process.exit(1);
  }

  // 2. Clear (only the campaign collections — `users` is sacred).
  if (nonEmpty.length) {
    const writer = db.bulkWriter();
    for (const name of COLLECTION_NAMES) {
      const snapshot = await db.collection(name).get();
      for (const doc of snapshot.docs) writer.delete(doc.ref);
    }
    await writer.close();
    console.log(`✔ Cleared ${nonEmpty.join(', ')}`);
  }

  // 3. Write the campaign.
  const data = buildCampaign();
  const writer = db.bulkWriter();

  writer.set(db.collection('campaigns').doc('active'), data.campaign.data);
  for (const item of data.constituencies) {
    // The `id` lives in the document id, never inside the document — mappers
    // read `doc.id`, and a stray `id` field would break the rules' exact key
    // set on the next client write.
    const { id, ...fields } = item;
    writer.set(db.collection('constituencies').doc(id), fields);
  }
  for (const item of data.wards) writer.set(db.collection('wards').doc(item.id), item.data);
  for (const item of data.areas) writer.set(db.collection('areas').doc(item.id), item.data);
  for (const item of data.booths) writer.set(db.collection('booths').doc(item.id), item.data);
  for (const item of data.team) writer.set(db.collection('teamMembers').doc(item.id), item.data);
  for (const item of data.tasks) writer.add(db.collection('tasks'), item.data);
  for (const item of data.issues) writer.add(db.collection('issues'), item.data);
  for (const item of data.events) writer.add(db.collection('events'), item.data);
  for (const item of data.expenses) writer.add(db.collection('expenses'), item.data);
  for (const item of data.compliance) writer.add(db.collection('compliance'), item.data);
  for (const item of data.voters) writer.add(db.collection('voters'), item.data);

  await writer.close();

  const summary = [
    ['wards', data.wards.length],
    ['areas', data.areas.length],
    ['booths', data.booths.length],
    ['team members', data.team.length],
    ['voters', data.voters.length],
    ['tasks', data.tasks.length],
    ['issues', data.issues.length],
    ['events', data.events.length],
    ['expenses', data.expenses.length],
    ['compliance items', data.compliance.length],
  ];

  console.log(`\n✔ Seeded "${data.campaign.data.name}" into ${projectId}:`);
  for (const [label, count] of summary) console.log(`    ${label.padEnd(16)} ${count}`);
  console.log('');
  console.log('  Sign in through the app to see it. `users/{uid}` docs are created');
  console.log('  by sign-up, never by this script.\n');
}

main().catch((error) => {
  console.error(`\n✖ Seed failed: ${error.message}\n`);
  if (String(error.message).includes('credential')) {
    console.error('  Check GOOGLE_APPLICATION_CREDENTIALS and the service account.\n');
  }
  process.exit(1);
});
