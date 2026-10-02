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

const CONS_ID = 'cons-jodhpur';
const WARD_ID = 'ward-ratanada';
const AREA_ID = 'area-chowk';
const BOOTH_ID = 'booth-118';

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
const anon = () => testEnv.unauthenticatedContext().firestore();

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

  it('denies listing the collection', async () => {
    // No `list` rule at all. Allowing it would let any signed-in user
    // enumerate every account in the project.
    await assertFails(getDocs(collection(alice(), 'users')));
  });

  it('requires onboarded === false on create', async () => {
    // Otherwise a client could sign up already onboarded and skip the flow.
    await assertFails(
      setDoc(doc(bob(), 'users', BOB), {
        email: 'bob@example.com',
        displayName: null,
        photoURL: null,
        onboarded: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    await assertSucceeds(
      setDoc(doc(bob(), 'users', BOB), {
        email: 'bob@example.com',
        displayName: null,
        photoURL: null,
        onboarded: false,
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

describe('/voters', () => {
  it('accepts a well-formed create', async () => {
    await assertSucceeds(addDoc(collection(alice(), 'voters'), validVoter()));
  });

  it('rejects any attempt at political profiling', async () => {
    // The blueprint's product boundary, enforced at the rules layer rather
    // than in the form UI.
    await assertFails(addDoc(collection(alice(), 'voters'), validVoter({ party: 'BJP' })));
    await assertFails(
      addDoc(collection(alice(), 'voters'), validVoter({ preference: 'undecided' }))
    );
    await assertFails(
      addDoc(collection(alice(), 'voters'), validVoter({ votedFor: 'candidate-x' }))
    );
  });

  it('rejects an under-age roll entry and a bad gender code', async () => {
    await assertFails(addDoc(collection(alice(), 'voters'), validVoter({ age: 17 })));
    await assertFails(addDoc(collection(alice(), 'voters'), validVoter({ gender: 'f' })));
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
