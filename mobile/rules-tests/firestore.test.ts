import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * firestore.rules, actually executed.
 *
 * This is the one test that exercises the real security boundary. The route
 * guards in app/_layout.tsx are a convenience; the client SDK's local cache
 * happily accepts writes the server would reject. Only this file finds out
 * what the server actually does.
 *
 * Needs the emulators, so run it with:
 *
 *     npm run rules:test
 *
 * A JDK 21 or newer has to be on your PATH — the emulators are Java processes
 * and firebase-tools 15 refuses to start on anything older.
 */

const ALICE = 'uid-alice';
const BOB = 'uid-bob';
const CARA = 'uid-cara';
const DAKSH = 'uid-daksh';

const CONS_ID = 'cons-jodhpur';
const WARD_ID = 'ward-ratanada';
const AREA_ID = 'area-chowk';
const BOOTH_ID = 'booth-118';

/** The roll's ward numbering — a separate axis from the campaign's ward slugs. */
const ROLL_WARD = 3;

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'campaign-rules-test',
    firestore: {
      rules: readFileSync(path.resolve(__dirname, '..', 'firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const now = Timestamp.now();

    await setDoc(doc(db, 'users', ALICE), {
      email: 'alice@example.com',
      displayName: 'Alice',
      photoURL: null,
      onboarded: true,
      createdAt: now,
      updatedAt: now,
      role: 'superAdmin',
      wardNo: null,
    });

    // A karykarta scoped to one ward. The ward-scoping tests below all run as
    // this user, because "can read their ward" is only interesting when there
    // is a ward they cannot read.
    await setDoc(doc(db, 'users', BOB), {
      email: 'bob@example.com',
      displayName: 'Bob',
      photoURL: null,
      onboarded: true,
      createdAt: now,
      updatedAt: now,
      role: 'karykarta',
      wardNo: ROLL_WARD,
    });

    // Signed in, but no role has been assigned. This is every account between
    // sign-up and a super admin granting access — it must have no capabilities,
    // not default ones.
    await setDoc(doc(db, 'users', CARA), {
      email: 'cara@example.com',
      displayName: 'Cara',
      photoURL: null,
      onboarded: true,
      createdAt: now,
      updatedAt: now,
    });

    await setDoc(doc(db, 'users', DAKSH), {
      email: 'daksh@example.com',
      displayName: 'Daksh',
      photoURL: null,
      onboarded: true,
      createdAt: now,
      updatedAt: now,
      role: 'admin',
      wardNo: null,
    });

    await setDoc(doc(db, 'campaigns', 'active'), {
      name: 'Jodhpur Ward Campaign',
      candidateName: 'Meera Sharma',
      constituencyName: 'Jodhpur',
      electionDate: 1793461800000,
      tagline: 'Door to door, ward by ward',
      startDate: 1767225000000,
      updatedAt: now,
    });

    await setDoc(doc(db, 'constituencies', CONS_ID), { name: 'Jodhpur', code: 'RJ-11' });
    await setDoc(doc(db, 'wards', WARD_ID), { name: 'Ratanada', constituencyId: CONS_ID });
    await setDoc(doc(db, 'areas', AREA_ID), { name: 'Chowk', wardId: WARD_ID, constituencyId: CONS_ID });
    await setDoc(doc(db, 'booths', BOOTH_ID), {
      number: 118,
      name: 'Govt Upper Primary School',
      address: 'Near the clock tower',
      areaId: AREA_ID,
      wardId: WARD_ID,
      constituencyId: CONS_ID,
      estimatedVoters: 940,
      coordinatorId: '',
    });

    // The imported roll, in the shape `scripts/seed-roll.mjs` writes. Two rows
    // so a ward-scoping test can assert that the other ward's row is *not*
    // readable, not merely that the query returns nothing.
    await setDoc(doc(db, 'voters', `w${ROLL_WARD}-1`), {
      wardNo: ROLL_WARD,
      serialNo: 1,
      epicId: 'CTK4949558',
      name: 'मुकेश कुमार',
      relation: 'father',
      relationLabel: 'पिता',
      fatherOrHusbandName: 'अर्जुन शर्मा',
      houseNo: '0',
      age: 54,
      gender: 'male',
      genderLabel: 'पुरूष',
      locality: 'बाबा रामदेव नगर',
      pdfPage: 3,
    });

    await setDoc(doc(db, 'voters', 'w7-1'), {
      wardNo: 7,
      serialNo: 1,
      epicId: 'CTK4949600',
      name: 'हरिराम',
      relation: 'father',
      relationLabel: 'पिता',
      fatherOrHusbandName: 'सीताराम',
      houseNo: '0',
      age: 51,
      gender: 'male',
      genderLabel: 'पुरूष',
      locality: 'शंकरनगर',
      pdfPage: 33,
    });

    await setDoc(doc(db, 'tasks', 'task-1'), {
      title: 'Sweep the north lane',
      description: '',
      assigneeId: '',
      areaId: AREA_ID,
      boothId: '',
      dueDate: 1769903400000,
      status: 'pending',
      report: '',
      createdBy: ALICE,
      createdAt: now,
      updatedAt: now,
    });
  });
});

const alice = () => testEnv.authenticatedContext(ALICE).firestore();
const bob = () => testEnv.authenticatedContext(BOB).firestore();
const cara = () => testEnv.authenticatedContext(CARA).firestore();
const daksh = () => testEnv.authenticatedContext(DAKSH).firestore();
const anon = () => testEnv.unauthenticatedContext().firestore();

/** Queries the roll the way `lib/roll/firestore-source.ts` does. */
const votersInWard = (db: Firestore, wardNo: number) =>
  getDocs(query(collection(db, 'voters'), where('wardNo', '==', wardNo)));

/** The roll row of `ROLL_WARD`, written in `beforeEach`. */
const ownWardVoter = (db: Firestore) => doc(db, 'voters', `w${ROLL_WARD}-1`);

const validTask = (overrides: Record<string, unknown> = {}) => ({
  title: 'Knock every door on lane 4',
  description: 'Leave a flyer if nobody answers.',
  assigneeId: '',
  areaId: AREA_ID,
  boothId: '',
  dueDate: null,
  status: 'pending',
  report: '',
  createdBy: ALICE,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  ...overrides,
});

const validVoter = (overrides: Record<string, unknown> = {}) => ({
  rollId: 'RJ11-118-00042',
  name: 'Sunita Devi',
  gender: 'female',
  age: 34,
  houseNo: '12',
  mobile: '9876543210',
  boothId: BOOTH_ID,
  areaId: AREA_ID,
  wardId: WARD_ID,
  constituencyId: CONS_ID,
  ...overrides,
});

describe('/users/{uid}', () => {
  it('lets a user read their own document', async () => {
    await assertSucceeds(getDoc(doc(alice(), 'users', ALICE)));
  });

  it('denies reading someone else’s', async () => {
    await assertFails(getDoc(doc(bob(), 'users', ALICE)));
    await assertFails(getDoc(doc(anon(), 'users', ALICE)));
  });

  it('allows a superAdmin to list users, and nobody else', async () => {
    // The list exposes every account's email and role, so it is an
    // account-management capability — not something a karykarta gets.
    await assertSucceeds(getDocs(collection(alice(), 'users')));
    await assertFails(getDocs(collection(bob(), 'users')));
    await assertFails(getDocs(collection(cara(), 'users')));
    await assertFails(getDocs(collection(anon(), 'users')));
  });

  it('requires onboarded === false on create', async () => {
    // A fresh uid — `beforeEach` already created documents for ALICE..DAKSH,
    // and a create against an existing document is a denied update.
    const FRESH = 'uid-fresh';

    // Otherwise a client could sign up already onboarded and skip the flow.
    await assertFails(
      setDoc(doc(bob(), 'users', FRESH), {
        email: 'fresh@example.com',
        displayName: null,
        photoURL: null,
        onboarded: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    await assertSucceeds(
      setDoc(doc(bob(), 'users', FRESH), {
        email: 'fresh@example.com',
        displayName: null,
        photoURL: null,
        onboarded: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('will not let a client grant itself a role on create', async () => {
    // `role` is not in the create allow-list, so sign-up cannot produce an
    // admin. Roles are granted afterwards, through the superAdmin update rule.
    await assertFails(
      setDoc(doc(cara(), 'users', 'uid-selfpromoted'), {
        email: 'sneaky@example.com',
        displayName: null,
        photoURL: null,
        onboarded: false,
        role: 'developer',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('allows only the four mutable fields on update', async () => {
    await assertSucceeds(
      updateDoc(doc(alice(), 'users', ALICE), {
        displayName: 'Ada',
        updatedAt: serverTimestamp(),
      })
    );

    // `email` mirrors the Auth record. Letting the client edit it here would
    // put the two out of step with nothing to reconcile them.
    await assertFails(
      updateDoc(doc(alice(), 'users', ALICE), {
        email: 'someone-else@example.com',
        updatedAt: serverTimestamp(),
      })
    );
  });
});

describe('the shared campaign', () => {
  it('is readable by any signed-in user and by nobody else', async () => {
    await assertSucceeds(getDoc(doc(alice(), 'campaigns', 'active')));
    await assertSucceeds(getDoc(doc(bob(), 'campaigns', 'active')));
    await assertFails(getDoc(doc(anon(), 'campaigns', 'active')));
  });

  it('takes a valid update but not an unknown field', async () => {
    await assertSucceeds(
      updateDoc(doc(alice(), 'campaigns', 'active'), {
        tagline: 'Every lane counts',
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(
      updateDoc(doc(alice(), 'campaigns', 'active'), {
        isPaidCampaign: true,
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('cannot be deleted', async () => {
    await assertFails(deleteDoc(doc(alice(), 'campaigns', 'active')));
  });
});

describe('shared collections', () => {
  it('lists without any owner scoping for a signed-in user', async () => {
    // The headline change from the starter app: these are campaign-shared
    // documents, so the query needs no where() to be provably safe — the rule
    // is satisfied by authentication alone.
    await assertSucceeds(
      getDocs(query(collection(alice(), 'tasks'), orderBy('createdAt', 'desc'), limit(50)))
    );
    // …and a second user sees the same roll, not a private slice of it.
    await assertSucceeds(getDocs(collection(bob(), 'tasks')));
  });

  it('is fully denied to a signed-out client', async () => {
    await assertFails(getDocs(collection(anon(), 'tasks')));
    await assertFails(getDoc(doc(anon(), 'campaigns', 'active')));
  });

  it('accepts an equality-scoped query', async () => {
    await assertSucceeds(
      getDocs(query(collection(alice(), 'tasks'), where('boothId', '==', BOOTH_ID)))
    );
  });
});

describe('/tasks', () => {
  it('accepts a well-formed create', async () => {
    await assertSucceeds(addDoc(collection(alice(), 'tasks'), validTask()));
  });

  it('rejects a forged createdAt', async () => {
    await assertFails(
      addDoc(collection(alice(), 'tasks'), {
        ...validTask(),
        createdAt: Timestamp.fromDate(new Date('2020-01-01')),
      })
    );
  });

  it('rejects a status outside the vocabulary', async () => {
    await assertFails(
      addDoc(collection(alice(), 'tasks'), validTask({ status: 'whenever' }))
    );
  });

  it('rejects a missing or unknown field', async () => {
    // Exact key sets: hasOnly stops extras, hasAll stops omissions. A task
    // written without `status` would be a row every filter silently drops.
    const { report: _omitted, ...missingReport } = validTask();
    await assertFails(addDoc(collection(alice(), 'tasks'), missingReport));
    await assertFails(addDoc(collection(alice(), 'tasks'), validTask({ ownerId: ALICE })));
  });

  it('allows a normal update but not one that rewrites createdAt', async () => {
    await assertSucceeds(
      updateDoc(doc(alice(), 'tasks', 'task-1'), {
        status: 'completed',
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(
      updateDoc(doc(alice(), 'tasks', 'task-1'), {
        createdAt: Timestamp.now(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('denies deleting to a signed-out client', async () => {
    await assertFails(deleteDoc(doc(anon(), 'tasks', 'task-1')));
    await assertSucceeds(deleteDoc(doc(alice(), 'tasks', 'task-1')));
  });
});

describe('/voters — the imported roll', () => {
  it('is read-only: no create, update or delete, for any role', async () => {
    // The roll is the reference copy of an official document. Every role is
    // denied, including developer — there is no client path that edits it, so
    // this asserts the guarantee rather than trusting the UI to never call one.
    await assertFails(addDoc(collection(alice(), 'voters'), validVoter()));
    await assertFails(updateDoc(ownWardVoter(alice()), { name: 'Tampered' }));
    await assertFails(deleteDoc(ownWardVoter(alice())));
    await assertFails(addDoc(collection(bob(), 'voters'), validVoter()));
    await assertFails(updateDoc(ownWardVoter(bob()), { name: 'Tampered' }));
  });

  it('rejects political fields on every writable collection', async () => {
    // The roll itself denies writes, so the product boundary is asserted on the
    // collections clients CAN write — this is the check that would catch a
    // future change opening profiling up.
    await assertFails(
      addDoc(collection(alice(), 'tasks'), validTask({ party: 'BJP' }))
    );
    await assertFails(
      addDoc(collection(alice(), 'voters'), validVoter({ votedFor: 'candidate-x' }))
    );
  });

  it('lets a karykarta read their assigned ward', async () => {
    await assertSucceeds(getDoc(ownWardVoter(bob())));
    await assertSucceeds(votersInWard(bob(), ROLL_WARD));
  });

  it('denies a karykarta every other ward', async () => {
    // Bob is assigned ward 3. Reading ward 7 fails per-document, which fails
    // the whole query — the safe direction to fail in.
    await assertFails(getDoc(doc(bob(), 'voters', 'w7-1')));
    await assertFails(votersInWard(bob(), 7));
  });

  it('denies a karykarta the unfiltered collection', async () => {
    // The `where` clause is not optional for a scoped role. This is the query
    // `firestore-source.ts` would build for `wardNo === null`, so the guard
    // that stops it belongs here rather than only in the client.
    await assertFails(getDocs(collection(bob(), 'voters')));
  });

  it('denies a user with no role', async () => {
    // Cara is signed in and onboarded but has no role. Inert, not privileged.
    await assertFails(getDoc(ownWardVoter(cara())));
    await assertFails(getDocs(collection(cara(), 'voters')));
    await assertFails(getDocs(collection(cara(), 'tasks')));
    await assertFails(getDocs(collection(cara(), 'wards')));
    await assertFails(addDoc(collection(cara(), 'tasks'), validTask()));
  });

  it('lets admin and superAdmin read every ward', async () => {
    await assertSucceeds(getDoc(ownWardVoter(daksh())));
    await assertSucceeds(getDoc(doc(daksh(), 'voters', 'w7-1')));
    await assertSucceeds(getDocs(collection(daksh(), 'voters')));
    await assertSucceeds(getDocs(collection(alice(), 'voters')));
  });

  it('denies the roll to a signed-out client', async () => {
    await assertFails(getDocs(collection(anon(), 'voters')));
    await assertFails(getDoc(doc(anon(), 'voters', `w${ROLL_WARD}-1`)));
  });
});

describe('/wards — seeded data', () => {
  it('is read-only from the client for every role', async () => {
    // Ward documents being un-writable is what makes `wardNo` trustworthy: a
    // client cannot invent a ward, so it cannot widen its own scope.
    await assertFails(setDoc(doc(alice(), 'wards', '99'), { name: 'Invented', constituencyId: CONS_ID }));
    await assertFails(updateDoc(doc(daksh(), 'wards', WARD_ID), { name: 'Renamed' }));
    await assertFails(deleteDoc(doc(alice(), 'wards', WARD_ID)));
  });

  it('is readable by any role that can read voters', async () => {
    // The ward selector has to work for a karykarta, or they cannot tell which
    // ward is theirs.
    await assertSucceeds(getDoc(doc(bob(), 'wards', WARD_ID)));
    await assertSucceeds(getDocs(collection(bob(), 'wards')));
  });
});

describe('role assignment', () => {
  it('lets a superAdmin set a role and a ward', async () => {
    await assertSucceeds(
      updateDoc(doc(alice(), 'users', CARA), { role: 'karykarta', wardNo: ROLL_WARD })
    );

    // …and the grant takes effect immediately: Cara can now read that ward and
    // nothing else. This is why roles live in a document rather than in a
    // custom claim — a claim would not apply until the token refreshed.
    await assertSucceeds(getDoc(ownWardVoter(cara())));
    await assertFails(getDoc(doc(cara(), 'voters', 'w7-1')));
  });

  it('denies a karykarta the ability to promote anyone', async () => {
    await assertFails(updateDoc(doc(bob(), 'users', CARA), { role: 'superAdmin' }));
  });

  it('denies a self-promotion through the role rule', async () => {
    // The grant rule excludes `userId == request.auth.uid`. Without it, a super
    // admin editing their own profile could hand themselves a role they do not
    // already hold — and an admin could edit their own ward assignment to
    // escape the scoping they were given.
    await assertFails(updateDoc(doc(alice(), 'users', ALICE), { role: 'developer' }));
    await assertFails(updateDoc(doc(daksh(), 'users', DAKSH), { wardNo: 1 }));
  });

  it('rejects a role outside the vocabulary', async () => {
    await assertFails(updateDoc(doc(alice(), 'users', CARA), { role: 'root' }));
  });

  it('rejects a ward that is not a positive integer', async () => {
    await assertFails(updateDoc(doc(alice(), 'users', CARA), { wardNo: '3' }));
    await assertFails(updateDoc(doc(alice(), 'users', CARA), { wardNo: 0 }));
    await assertFails(updateDoc(doc(alice(), 'users', CARA), { wardNo: -3 }));
  });

  it('will not let a role change ride along with a displayName change', async () => {
    // The two update rules are separate on purpose. If they were merged, "update
    // your name" and "promote yourself" would be one rule and the only thing
    // between them would be remembering which fields you sent.
    await assertFails(
      updateDoc(doc(alice(), 'users', CARA), {
        displayName: 'Also promoted',
        role: 'admin',
      })
    );
    await assertSucceeds(updateDoc(doc(alice(), 'users', CARA), { displayName: 'Renamed' }));
  });
});

describe('/issues', () => {
  const validIssue = (overrides: Record<string, unknown> = {}) => ({
    category: 'road',
    title: 'Broken pavement near the chowk',
    description: 'Two-wheelers are swerving into traffic.',
    areaId: AREA_ID,
    photoUrl: '',
    status: 'open',
    reportedBy: 'Alice',
    reportedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  });

  it('accepts a well-formed create', async () => {
    await assertSucceeds(addDoc(collection(alice(), 'issues'), validIssue()));
  });

  it('rejects a forged reportedAt and a bad category', async () => {
    await assertFails(
      addDoc(collection(alice(), 'issues'), {
        ...validIssue(),
        reportedAt: Timestamp.fromDate(new Date('2019-05-01')),
      })
    );
    await assertFails(addDoc(collection(alice(), 'issues'), validIssue({ category: 'grudge' })));
  });
});

describe('/expenses', () => {
  const validExpense = (overrides: Record<string, unknown> = {}) => ({
    date: 1769903400000,
    category: 'travel',
    amount: 450,
    description: 'Auto to Ratanada',
    receiptUrl: '',
    status: 'pending',
    createdBy: ALICE,
    createdAt: serverTimestamp(),
    ...overrides,
  });

  it('accepts a well-formed create', async () => {
    await assertSucceeds(addDoc(collection(alice(), 'expenses'), validExpense()));
  });

  it('rejects a negative amount, a bad status and a forged createdAt', async () => {
    await assertFails(addDoc(collection(alice(), 'expenses'), validExpense({ amount: -5 })));
    await assertFails(addDoc(collection(alice(), 'expenses'), validExpense({ status: 'paid' })));
    await assertFails(
      addDoc(collection(alice(), 'expenses'), {
        ...validExpense(),
        createdAt: Timestamp.fromDate(new Date('2020-01-01')),
      })
    );
  });
});

describe('/events', () => {
  const validEvent = (overrides: Record<string, unknown> = {}) => ({
    title: 'Ward volunteers meeting',
    type: 'meeting',
    startsAt: 1769903400000,
    endsAt: 1769907000000,
    location: 'Ward office',
    description: '',
    createdAt: serverTimestamp(),
    ...overrides,
  });

  it('accepts a well-formed create', async () => {
    await assertSucceeds(addDoc(collection(alice(), 'events'), validEvent()));
  });

  it('rejects a missing start or a bad type', async () => {
    const { startsAt: _omitted, ...noStart } = validEvent();
    await assertFails(addDoc(collection(alice(), 'events'), noStart));
    await assertFails(addDoc(collection(alice(), 'events'), validEvent({ type: 'party' })));
  });
});

describe('/booths and /teamMembers', () => {
  it('rejects a booth without a number and a team member with a bad role', async () => {
    await assertFails(
      addDoc(collection(alice(), 'booths'), {
        number: 'one hundred',
        name: 'School',
        address: '',
        areaId: AREA_ID,
        wardId: WARD_ID,
        constituencyId: CONS_ID,
        estimatedVoters: 900,
        coordinatorId: '',
      })
    );
    await assertFails(
      addDoc(collection(alice(), 'teamMembers'), {
        name: 'Ravi',
        phone: '',
        role: 'manager',
        status: 'active',
        areaId: AREA_ID,
        boothId: '',
      })
    );
  });

  it('lets a signed-in user staff a booth', async () => {
    await assertSucceeds(
      updateDoc(doc(alice(), 'booths', BOOTH_ID), { coordinatorId: 'member-ravi' })
    );
  });
});

describe('everything else', () => {
  it('is denied, because there is no catch-all match', async () => {
    // The absence of `match /{document=**}` is load-bearing. Without this
    // assertion, someone adding one back "to fix a permission error" would
    // open every future collection and no test would notice.
    await assertFails(getDocs(collection(alice(), 'secrets')));
    await assertFails(setDoc(doc(alice(), 'secrets/s1'), { value: 1 }));
  });
});
