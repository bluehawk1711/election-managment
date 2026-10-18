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
  deleteField,
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

  it('lets superAdmin and admin list users, but not karykarta or a roleless account', async () => {
    // The list exposes every account's email and role, so it is an
    // account-management capability — never something a karykarta or a
    // freshly roleless account gets. Admin reads it because everything a
    // super admin creates has to be visible to the people below them
    // (`canViewAccounts` / `accountView`); creating and re-roling still goes
    // through `canManageAccounts`, asserted under "role assignment" below.
    await assertSucceeds(getDocs(collection(alice(), 'users')));
    await assertSucceeds(getDocs(collection(daksh(), 'users')));
    await assertFails(getDocs(collection(bob(), 'users')));
    await assertFails(getDocs(collection(cara(), 'users')));
    await assertFails(getDocs(collection(anon(), 'users')));
  });

  it('requires onboarded === false on create', async () => {
    // A brand-new account: no `users` document exists for this uid yet, which
    // is the real sign-up path. `beforeEach` only seeds ALICE..DAKSH.
    const FRESH = 'uid-fresh';
    const fresh = testEnv.authenticatedContext(FRESH).firestore();

    // Otherwise a client could sign up already onboarded and skip the flow.
    await assertFails(
      setDoc(doc(fresh, 'users', FRESH), {
        email: 'fresh@example.com',
        displayName: null,
        photoURL: null,
        onboarded: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // Note this also pins down that a create does NOT trip the role-grant
    // `update` rule above. Firestore evaluates `update` rules during a `create`,
    // and `&&` does not short-circuit, so the role lookup runs against a
    // document that does not exist — which is why that rule needs `exists()`
    // and `resource != null` guards. Without them this assertion fails with an
    // opaque `PERMISSION_DENIED: evaluation error` rather than the plain denial.
    await assertSucceeds(
      setDoc(doc(fresh, 'users', FRESH), {
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
    const SNEAKY = 'uid-selfpromoted';
    const sneaky = testEnv.authenticatedContext(SNEAKY).firestore();

    await assertFails(
      setDoc(doc(sneaky, 'users', SNEAKY), {
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

  // The "super admin creates someone ELSE's account" rule — the one
  // `more/users/new.tsx` runs against. It had no coverage at all, and a
  // malformed email check (`text(email, 3, 320)`, not a valid rules call)
  // made every write through it fail evaluation. Karykarta was the loudest
  // symptom because it is the form's default role.
  describe('superAdmin creating another account', () => {
    /** The exact key set `hooks/useCreateAccount.ts` writes. */
    const newAccount = (over: Record<string, unknown>) => ({
      email: 'newbie@example.com',
      displayName: 'Newbie',
      photoURL: null,
      onboarded: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...over,
    });

    it('creates a karykarta with a positive ward', async () => {
      await assertSucceeds(
        setDoc(
          doc(alice(), 'users', 'uid-new-karykarta'),
          newAccount({ role: 'karykarta', wardNo: ROLL_WARD })
        )
      );
    });

    it('creates an admin with NO ward', async () => {
      await assertSucceeds(
        setDoc(
          doc(alice(), 'users', 'uid-new-admin'),
          newAccount({ role: 'admin' })
        )
      );
    });

    it('rejects a karykarta without a ward', async () => {
      await assertFails(
        setDoc(
          doc(alice(), 'users', 'uid-wardless'),
          newAccount({ role: 'karykarta' })
        )
      );
    });

    it('rejects a karykarta with ward 0', async () => {
      await assertFails(
        setDoc(
          doc(alice(), 'users', 'uid-zero-ward'),
          newAccount({ role: 'karykarta', wardNo: 0 })
        )
      );
    });

    it('rejects an admin WITH a ward', async () => {
      await assertFails(
        setDoc(
          doc(alice(), 'users', 'uid-scoped-admin'),
          newAccount({ role: 'admin', wardNo: ROLL_WARD })
        )
      );
    });

    it('rejects creating your own account with a role', async () => {
      await assertFails(
        setDoc(
          doc(alice(), 'users', ALICE),
          newAccount({ role: 'superAdmin' })
        )
      );
    });

    it('rejects an admin and a karykarta trying to create accounts', async () => {
      await assertFails(
        setDoc(
          doc(daksh(), 'users', 'uid-from-admin'),
          newAccount({ role: 'karykarta', wardNo: ROLL_WARD })
        )
      );
      await assertFails(
        setDoc(
          doc(bob(), 'users', 'uid-from-karykarta'),
          newAccount({ role: 'karykarta', wardNo: ROLL_WARD })
        )
      );
    });

    it('rejects an email shorter than 3 characters', async () => {
      await assertFails(
        setDoc(
          doc(alice(), 'users', 'uid-bad-email'),
          newAccount({ email: 'a@', role: 'admin' })
        )
      );
    });
  });
});

describe('/users/{uid}/voterEdits — the account-private overlay sync', () => {
  /** The shape `lib/roll/sync.ts::remotePayload` writes for a changed voter. */
  const pushed = (extra: Record<string, unknown> = {}) => ({
    wardNo: ROLL_WARD,
    updatedAt: 1_770_000_000_000,
    updatedBy: ALICE,
    phone: '9876543210',
    ...extra,
  });

  const edit = (db: Firestore, voterId = `w${ROLL_WARD}-1`) =>
    doc(db, 'users', ALICE, 'voterEdits', voterId);

  it('lets the owner write and read their own edits', async () => {
    await assertSucceeds(setDoc(edit(alice()), pushed()));
    await assertSucceeds(getDoc(edit(alice())));
    // The pull is one list over the whole subcollection — it must be allowed,
    // or sync would push fine and never read anything back on a new device.
    await assertSucceeds(getDocs(collection(alice(), 'users', ALICE, 'voterEdits')));
  });

  it('is invisible to every other account — push and pull alike', async () => {
    await assertSucceeds(setDoc(edit(alice()), pushed()));

    // The privacy property the user asked for: same login, any device =
    // their edits; anybody else = nothing, not even a list of doc ids.
    await assertFails(getDoc(edit(bob())));
    await assertFails(getDocs(collection(bob(), 'users', ALICE, 'voterEdits')));
    await assertFails(
      setDoc(edit(bob()), pushed({ updatedBy: BOB }), { merge: true })
    );
    await assertFails(getDoc(edit(anon())));
  });

  it('lets account managers audit any account’s edits — and only them', async () => {
    await assertSucceeds(setDoc(edit(alice()), pushed()));

    // The "which voter changes did each user make" surface: a roster viewer
    // (admin and up, `canViewAccounts`) reads the overlay — the keys that
    // user touched and when — exactly like the owner's own devices do.
    await assertSucceeds(getDoc(edit(daksh())));
    await assertSucceeds(getDocs(collection(daksh(), 'users', ALICE, 'voterEdits')));

    // Widening VISIBILITY to the roster must not widen it to the team:
    // karykarta and roleless accounts still see only their own documents.
    await assertFails(getDoc(edit(cara())));
    await assertFails(getDocs(collection(cara(), 'users', ALICE, 'voterEdits')));
  });

  it('rejects a document missing the bookkeeping fields', async () => {
    // `pushEdits` always writes all three; a client that bypasses it writes
    // an un-attributable, un-orderable overlay — hasAll is what says no.
    await assertFails(setDoc(edit(alice()), { phone: '9876543210' }));
    await assertFails(
      setDoc(edit(alice()), { wardNo: ROLL_WARD, updatedAt: 1, phone: '9' })
    );

    // …and with all three present the doc is legal even carrying no edit
    // fields — bookkeeping-only is harmless (an empty overlay), so this
    // asserts the OTHER direction: the failures above are `hasAll` firing,
    // not some blanket rule rejecting every minimal write.
    await assertSucceeds(
      setDoc(edit(alice()), {
        wardNo: ROLL_WARD,
        updatedAt: 1,
        updatedBy: ALICE,
      })
    );
  });

  it('rejects political profiling and unknown keys', async () => {
    // `support` (with us / against us) sits on the product's hard banlist in
    // every other collection; here it is rejected by omission — not on the
    // allowlist — and the tests pin both its spellings.
    await assertFails(setDoc(edit(alice()), pushed({ support: 'opponent' })));
    await assertFails(setDoc(edit(alice()), pushed({ party: 'x' })));
    await assertFails(setDoc(edit(alice()), pushed({ votedFor: 'us' })));
    // An unknown key is a rejected write, never silently stored data.
    await assertFails(setDoc(edit(alice()), pushed({ nickname: 'x' })));
  });

  it('rejects illegal ward, gender, voted and leaning values', async () => {
    await assertFails(setDoc(edit(alice()), pushed({ wardNo: -1 })));
    await assertFails(setDoc(edit(alice()), pushed({ wardNo: 'one' })));
    await assertFails(setDoc(edit(alice()), pushed({ voted: 'maybe' })));
    await assertFails(setDoc(edit(alice()), pushed({ leaning: 'up' })));
    await assertFails(setDoc(edit(alice()), pushed({ gender: 'unknown' })));
    await assertFails(setDoc(edit(alice()), pushed({ updatedAt: null })));
    await assertFails(setDoc(edit(alice()), pushed({ updatedBy: '' })));

    // …and accepts the legal enums, so the denials above are the enum check
    // firing rather than some other clause failing every write here.
    await assertSucceeds(
      setDoc(edit(alice()),
        pushed({ gender: 'female', voted: 'voted', leaning: 'center' }))
    );
  });

  it('lets the owner delete, and only the owner', async () => {
    await assertSucceeds(setDoc(edit(alice()), pushed()));
    await assertFails(deleteDoc(edit(bob())));
    await assertSucceeds(deleteDoc(edit(alice())));
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

  it('denies an admin managing accounts — view does not imply manage', async () => {
    // `accountView` lets an admin READ the roster; every write path is
    // `canManageAccounts`. This is the assertion that keeps the widened list
    // rule from ever drifting into create/role-grant territory.
    await assertFails(
      updateDoc(doc(daksh(), 'users', CARA), { role: 'superAdmin' })
    );
    const NEW = 'uid-made-by-admin';
    const newbie = testEnv.authenticatedContext(NEW).firestore();
    // A client cannot create its own fresh profile through this context —
    // the sign-up path is the owner-create rule (onboarded === false, no role),
    // which fails here because the caller's own document does not exist yet
    // for the role lookup… and creating somebody ELSE's profile with a role
    // attached is the super-admin create rule, which an admin must not pass.
    await assertFails(
      setDoc(doc(newbie, 'users', NEW), {
        email: 'made@example.com',
        displayName: 'Made',
        photoURL: null,
        onboarded: true,
        role: 'karykarta',
        wardNo: ROLL_WARD,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(
      setDoc(doc(daksh(), 'users', NEW), {
        email: 'made@example.com',
        displayName: 'Made',
        photoURL: null,
        onboarded: true,
        role: 'karykarta',
        wardNo: ROLL_WARD,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(deleteDoc(doc(daksh(), 'users', CARA)));
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

    // Renaming someone else's profile is denied too — that is the self-service
    // rule, which is scoped to your own document. Renaming YOUR OWN is the
    // write that has to keep working.
    await assertFails(updateDoc(doc(alice(), 'users', CARA), { displayName: 'Renamed' }));
    await assertSucceeds(updateDoc(doc(alice(), 'users', ALICE), { displayName: 'Ada' }));
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

describe('/voterPhones — shared team numbers + the super admin’s choice', () => {
  const proposalOf = (db: Firestore, voterId: string, uid: string) =>
    doc(db, 'voterPhones', voterId, 'proposals', uid);
  // Default to the ward's first roll row: these cases assert role and shape
  // rules, so the voterId itself is incidental.
  const boardOf = (db: Firestore, voterId = `w${ROLL_WARD}-1`) =>
    doc(db, 'voterPhones', voterId);

  const validProposal = (
    wardNo: number = ROLL_WARD,
    extra: Record<string, unknown> = {}
  ) => ({
    phone: '9876543210',
    authorName: 'Bob',
    wardNo,
    updatedAt: 1_770_000_000_000,
    ...extra,
  });

  const validFinal = (extra: Record<string, unknown> = {}) => ({
    wardNo: ROLL_WARD,
    finalPhone: '9876543210',
    finalizedBy: ALICE,
    finalizedName: 'Alice',
    finalizedAt: 1_770_000_000_000,
    ...extra,
  });

  it('lets a karykarta propose a number in their own ward', async () => {
    await assertSucceeds(
      setDoc(proposalOf(bob(), `w${ROLL_WARD}-1`, BOB), validProposal())
    );
  });

  it('refuses a proposal filed outside a karykarta’s ward', async () => {
    // ward 7 exists with a real roll row, so this fails on the *scope* check,
    // not on the roll-row lookup below it.
    await assertFails(setDoc(proposalOf(bob(), 'w7-1', BOB), validProposal(7)));
    // …and a mismatched ward number fails the roll-row equality even for an
    // unrestricted role: the board may only speak at a row’s own ward.
    await assertFails(
      setDoc(proposalOf(alice(), `w${ROLL_WARD}-1`, ALICE), validProposal(7))
    );
  });

  it('refuses a proposal for an id that is not a roll row', async () => {
    // `get(voters/$(voterId))` has no row to read — the board cannot collect
    // numbers against made-up ids. (A missing document here evaluates as an
    // error rather than a clean false; the assertion only cares that it
    // fails, because the app only ever passes ids from a loaded roll.)
    await assertFails(
      setDoc(proposalOf(alice(), 'w99999-1', ALICE), validProposal())
    );
  });

  it('keeps writes to your own proposal document', async () => {
    await assertSucceeds(setDoc(proposalOf(bob(), 'w3-1', BOB), validProposal()));
    // Another account cannot edit or replace someone else's entry — the doc
    // id IS the proposer's uid, so this is a path check.
    await assertFails(
      setDoc(proposalOf(alice(), 'w3-1', BOB), validProposal(ROLL_WARD, { authorName: 'Alice' }))
    );
    await assertFails(deleteDoc(proposalOf(alice(), 'w3-1', BOB)));
    // …while the owner can update and withdraw their own.
    await assertSucceeds(
      updateDoc(proposalOf(bob(), 'w3-1', BOB), {
        phone: '9811112222',
        updatedAt: 1_770_000_100_000,
      })
    );
    await assertSucceeds(deleteDoc(proposalOf(bob(), 'w3-1', BOB)));
  });

  it('applies the same exact key set and phone shape as the rules', async () => {
    await assertFails(setDoc(proposalOf(bob(), 'w3-1', BOB), validProposal(ROLL_WARD, { nickname: 'x' })));
    const { updatedAt: _dropped, ...missing } = validProposal();
    await assertFails(setDoc(proposalOf(bob(), 'w3-1', BOB), missing));
    await assertFails(setDoc(proposalOf(bob(), 'w3-1', BOB), validProposal(ROLL_WARD, { phone: 'call me' })));
    await assertFails(setDoc(proposalOf(bob(), 'w3-1', BOB), validProposal(ROLL_WARD, { phone: '123' })));
    await assertFails(setDoc(proposalOf(bob(), 'w3-1', BOB), validProposal(ROLL_WARD, { updatedAt: 'yesterday' })));
    // …and a well-formed one passes, so the denials above are those checks.
    await assertSucceeds(setDoc(proposalOf(bob(), 'w3-1', BOB), validProposal()));
  });

  it('denies a roleless account the board entirely — read and write', async () => {
    await assertFails(setDoc(proposalOf(cara(), 'w3-1', CARA), validProposal()));
    await assertFails(getDocs(collection(cara(), 'voterPhones', 'w3-1', 'proposals')));
    await assertFails(getDoc(doc(cara(), 'voterPhones', 'w3-1')));
  });

  it('scopes reads to the ward, like the roll itself', async () => {
    await assertSucceeds(setDoc(proposalOf(alice(), 'w7-1', ALICE), validProposal(7)));
    // The karykarta of ward 3 cannot see ward 7's board, proposal by proposal.
    await assertFails(getDoc(proposalOf(bob(), 'w7-1', ALICE)));
    await assertFails(getDocs(collection(bob(), 'voterPhones', 'w7-1', 'proposals')));
    // Their own ward reads fine, as do admin and super admin anywhere.
    await assertSucceeds(setDoc(proposalOf(bob(), 'w3-1', BOB), validProposal()));
    await assertSucceeds(getDoc(proposalOf(bob(), 'w3-1', BOB)));
    await assertSucceeds(getDocs(collection(daksh(), 'voterPhones', 'w3-1', 'proposals')));
    await assertSucceeds(getDoc(doc(bob(), 'voterPhones', 'w3-1')));
  });

  it('lets only a superAdmin put a number in use — and take it back out', async () => {
    // The choice every call button dials from then on: super admin +
    // developer only. Admin can READ the board (`accountView`'s cousin) but
    // the choice is not theirs — `contactFinalize` in lib/roles.ts.
    await assertSucceeds(setDoc(boardOf(alice()), validFinal()));
    // The cleared state: same five keys, empty phone, null timestamp.
    await assertSucceeds(
      setDoc(boardOf(alice()),
        validFinal({ finalPhone: '', finalizedBy: '', finalizedName: '', finalizedAt: null }))
    );
    await assertFails(setDoc(boardOf(daksh()), validFinal({ finalizedBy: DAKSH })));
    await assertFails(setDoc(boardOf(bob()), validFinal({ finalizedBy: BOB })));
    await assertFails(setDoc(boardOf(cara()), validFinal({ finalizedBy: CARA })));
    // Shape: a phone that is not a number, and a missing key, both refuse.
    await assertFails(setDoc(boardOf(alice()), validFinal({ finalPhone: 'nope' })));
    await assertFails(
      setDoc(boardOf(alice()), { wardNo: ROLL_WARD, finalPhone: '9876543210' })
    );
    // …and the super admin's own ward number must be the roll row's ward.
    await assertFails(setDoc(boardOf(alice()), validFinal({ wardNo: 7 })));
    await assertFails(deleteDoc(boardOf(daksh())));
    await assertSucceeds(deleteDoc(boardOf(alice())));
  });

  it('denies the board to a signed-out client', async () => {
    await assertFails(getDoc(doc(anon(), 'voterPhones', 'w3-1')));
    await assertFails(
      setDoc(proposalOf(anon(), 'w3-1', 'anyone'), validProposal())
    );
    await assertFails(setDoc(boardOf(anon()), validFinal()));
  });
});

describe('per-device account lock', () => {
  /** The exact four-key map `firestore.rules::validDevice` accepts. */
  const device = (
    id = '11111111-2222-3333-4444-555555555555',
    over: Record<string, unknown> = {}
  ) => ({
    id,
    name: 'Xiaomi Redmi Note 12',
    platform: 'android',
    lastActiveAt: 1_770_000_000_000,
    ...over,
  });

  /** The owner's lock-ON write — the foreign-device sign-in flow. */
  const selfLock = {
    locked: true,
    lockedReason: 'device_change',
    lockedAt: 1_770_000_000_000,
    lockedBy: 'system',
  };

  /** The super-admin unlock — clears every lock field AND the binding. */
  const unlock = {
    locked: false,
    lockedReason: '',
    lockedAt: null,
    lockedBy: '',
    device: deleteField(),
  };

  it('binds the device on first sign-in, then freezes the binding', async () => {
    // First launch: no device key, any shape-valid map goes on. Role-less is
    // deliberate — the binding happens at sign-in, before a role exists.
    await assertSucceeds(
      updateDoc(doc(cara(), 'users', CARA), {
        device: device(),
        updatedAt: serverTimestamp(),
      })
    );

    // After that the owner can neither swap it (a second laptop's attempt),
    // refresh it, nor drop it — "rebind" is exclusively the super-admin
    // unlock below. A two-write "delete, then add mine" bypass is closed by
    // the same first-bind-only clause on both writes.
    await assertFails(
      updateDoc(doc(cara(), 'users', CARA), {
        device: device('99999999-8888-7777-6666-555555555555'),
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(
      updateDoc(doc(cara(), 'users', CARA), {
        device: device(device().id, { lastActiveAt: 1_770_000_000_999 }),
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(
      updateDoc(doc(cara(), 'users', CARA), {
        device: deleteField(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('rejects a malformed device map', async () => {
    // Short id, missing keys, unknown platform, unknown extra key — four
    // shapes, four refusals — while Bob still has no binding to test against.
    await assertFails(
      updateDoc(doc(bob(), 'users', BOB), {
        device: device('short'),
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(
      updateDoc(doc(bob(), 'users', BOB), {
        device: { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(
      updateDoc(doc(bob(), 'users', BOB), {
        device: device('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', {
          platform: 'blackberry',
        }),
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(
      updateDoc(doc(bob(), 'users', BOB), {
        device: device('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', {
          ip: '10.0.0.1',
        }),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('locks itself on a foreign device, and only a super admin unlocks', async () => {
    // Bob binds his phone…
    await assertSucceeds(
      updateDoc(doc(bob(), 'users', BOB), {
        device: device(),
        updatedAt: serverTimestamp(),
      })
    );

    // …a bare `locked: true` with no reason and no stamp is rejected BEFORE
    // anything locks — the result must carry a legal reason and a real
    // timestamp whenever it ends up locked.
    await assertFails(
      updateDoc(doc(bob(), 'users', BOB), {
        locked: true,
        updatedAt: serverTimestamp(),
      })
    );

    // The app is next opened elsewhere: the OWNER path may flip the lock
    // ON, with a reason and a stamp.
    await assertSucceeds(
      updateDoc(doc(bob(), 'users', BOB), {
        ...selfLock,
        updatedAt: serverTimestamp(),
      })
    );

    // The asymmetry the product is built on: Bob can never unlock himself —
    // not through the owner path (was locked, result not locked) …
    await assertFails(
      updateDoc(doc(bob(), 'users', BOB), {
        ...unlock,
        updatedAt: serverTimestamp(),
      })
    );
    // …and through the manage path: Bob is not account management, so
    // unlocking SOMEONE ELSE (Cara, currently unlocked) is refused too.
    await assertFails(
      updateDoc(doc(bob(), 'users', CARA), {
        locked: false,
        lockedReason: '',
        lockedAt: null,
        lockedBy: '',
      })
    );

    // A super admin unlocks — lock fields cleared, device binding dropped in
    // the SAME write, so the rightful phone re-binds on its next sign-in.
    await assertSucceeds(updateDoc(doc(alice(), 'users', BOB), unlock));

    // …and everything the lock took away comes back.
    await assertSucceeds(votersInWard(bob(), ROLL_WARD));
    await assertSucceeds(getDoc(doc(bob(), 'tasks', 'task-1')));
  });

  it('strips a locked account of every capability but its own profile', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        context.firestore().doc(`users/${BOB}`),
        {
          device: device(),
          locked: true,
          lockedReason: 'admin',
          lockedAt: 1_770_000_000_000,
          lockedBy: ALICE,
        },
        { merge: true }
      );
    });

    // What still works is reading WHY the session is dead…
    await assertSucceeds(getDoc(doc(bob(), 'users', BOB)));

    // …and nothing else:
    await assertFails(votersInWard(bob(), ROLL_WARD));
    await assertFails(getDoc(ownWardVoter(bob())));
    await assertFails(getDoc(doc(bob(), 'tasks', 'task-1')));
    await assertFails(getDoc(doc(bob(), 'campaigns', 'active')));
    await assertFails(getDocs(collection(bob(), 'users')));
    await assertFails(getDocs(collection(bob(), 'tasks')));
    await assertFails(
      setDoc(doc(bob(), 'users', BOB, 'voterEdits', `w${ROLL_WARD}-1`), {
        wardNo: ROLL_WARD,
        updatedAt: 1,
        updatedBy: BOB,
        phone: '9876543211',
      })
    );

    // Somebody else's lock must not touch anyone else: the unlocked super
    // admin reads roll and campaign exactly as before.
    await assertSucceeds(votersInWard(alice(), ROLL_WARD));
    await assertSucceeds(getDoc(doc(alice(), 'tasks', 'task-1')));
  });

  it('only account management may lock or unlock ANOTHER account', async () => {
    const adminLock = {
      locked: true,
      lockedReason: 'admin',
      lockedAt: 1_770_000_000_000,
      lockedBy: ALICE,
    };

    // A karykarta cannot lock the colleague whose password they share…
    await assertFails(updateDoc(doc(bob(), 'users', CARA), adminLock));
    // …a roleless account manages nothing…
    await assertFails(updateDoc(doc(cara(), 'users', BOB), adminLock));
    // …and an ADMIN — who sees the roster — still cannot flip a lock, in
    // either direction. Lock/unlock sits with super admin + developer only.
    await assertFails(updateDoc(doc(daksh(), 'users', CARA), adminLock));
    await assertFails(
      updateDoc(doc(daksh(), 'users', CARA), {
        locked: false,
        lockedReason: '',
        lockedAt: null,
        lockedBy: '',
      })
    );

    // The super admin's write is the one that lands.
    await assertSucceeds(updateDoc(doc(alice(), 'users', CARA), adminLock));
  });

  it('does not let a super admin unlock their own account', async () => {
    // Alice locks herself (owner path allows lock-ON, whoever writes it)…
    await assertSucceeds(
      updateDoc(doc(alice(), 'users', ALICE), {
        ...selfLock,
        updatedAt: serverTimestamp(),
      })
    );

    // …and gets out only through ANOTHER super admin: the owner path refuses
    // every unlock, and the manage path requires `userId != request.auth.uid`.
    await assertFails(
      updateDoc(doc(alice(), 'users', ALICE), {
        locked: false,
        lockedReason: '',
        lockedAt: null,
        lockedBy: '',
      })
    );
    // While locked, even reading the roster is gone (canViewAccounts is
    // gated), so a locked super admin is inert except for their own doc.
    await assertFails(getDocs(collection(alice(), 'users')));
    await assertSucceeds(getDoc(doc(alice(), 'users', ALICE)));
  });
});

describe('/accountSecrets — the password vault', () => {
  const vault = (over: Record<string, unknown> = {}) => ({
    uid: BOB,
    email: 'bob@example.com',
    password: 'temppass1',
    updatedAt: 1_770_000_000_000,
    updatedBy: ALICE,
    ...over,
  });

  const secret = (db: Firestore, uid: string) => doc(db, 'accountSecrets', uid);

  it('round-trips for a super admin: write, read, rotate, delete', async () => {
    await assertSucceeds(setDoc(secret(alice(), BOB), vault()));
    await assertSucceeds(getDoc(secret(alice(), BOB)));
    await assertSucceeds(getDocs(collection(alice(), 'accountSecrets')));
    await assertSucceeds(
      updateDoc(secret(alice(), BOB), vault({ password: 'rotated42' }))
    );
    await assertSucceeds(deleteDoc(secret(alice(), BOB)));
  });

  it('is invisible to admins, karykarta, roleless and signed-out clients', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(context.firestore().doc(`accountSecrets/${BOB}`), vault());
    });

    // canManageAccounts is the ONLY key: an admin reads the roster but never
    // the credentials behind it.
    await assertFails(getDoc(secret(daksh(), BOB)));
    await assertFails(getDocs(collection(daksh(), 'accountSecrets')));
    await assertFails(setDoc(secret(daksh(), BOB), vault({ password: 'mine999' })));
    await assertFails(getDoc(secret(bob(), BOB)));
    await assertFails(getDoc(secret(cara(), BOB)));
    await assertFails(getDoc(secret(anon(), BOB)));
    await assertSucceeds(getDoc(secret(alice(), BOB)));
  });

  it('rejects a vault that does not describe the document’s own uid', async () => {
    await assertFails(setDoc(secret(alice(), BOB), vault({ uid: ALICE })));
  });

  it('rejects short passwords, missing keys and unknown keys', async () => {
    // Auth's floor is 6 characters — a vault entry below it could never have
    // been the real password.
    await assertFails(setDoc(secret(alice(), BOB), vault({ password: 'abc' })));
    const { password: _noPassword, ...missing } = vault();
    await assertFails(setDoc(secret(alice(), BOB), missing));
    await assertFails(setDoc(secret(alice(), BOB), vault({ mfaEnabled: true })));
  });
});

describe('/appConfig — the release gate', () => {
  const config = (over: Record<string, unknown> = {}) => ({
    latestVersion: '1.2.0',
    requiredVersion: '1.1.0',
    supportPhone: '919876543210',
    updatedAt: null,
    updatedBy: 'alice@example.com',
    ...over,
  });

  const general = (db: Firestore) => doc(db, 'appConfig', 'general');

  it('is readable while signed out — an outdated build must see the lock', async () => {
    await assertSucceeds(setDoc(general(alice()), config()));
    await assertSucceeds(getDoc(general(anon())));
    await assertSucceeds(getDoc(general(bob())));
    await assertSucceeds(getDoc(general(daksh())));
    await assertSucceeds(getDoc(general(cara())));
  });

  it('is written by a super admin and refused to everyone else', async () => {
    await assertFails(setDoc(general(daksh()), config()));
    await assertFails(setDoc(general(bob()), config()));
    await assertFails(setDoc(general(cara()), config()));
    await assertFails(setDoc(general(anon()), config()));
    await assertSucceeds(setDoc(general(alice()), config()));
  });

  it('rejects garbage versions, phones and unknown keys', async () => {
    // Semver shape — the client parses and compares; the rules only keep
    // junk out (raising the floor to "soon" would lock every build forever).
    await assertFails(setDoc(general(alice()), config({ requiredVersion: 'soon' })));
    await assertFails(setDoc(general(alice()), config({ latestVersion: '' })));
    // Support phone: digits only (wa.me), or empty = "not configured yet".
    await assertFails(setDoc(general(alice()), config({ supportPhone: '+91 98765' })));
    await assertSucceeds(setDoc(general(alice()), config({ supportPhone: '' })));
    // Exact keys — a stray field (say, an API token someone pastes in)
    // dies here rather than being stored next to the versions.
    await assertFails(setDoc(general(alice()), config({ apiKey: 'x' })));
  });

  it('cannot be deleted — a stale build would otherwise lose its own gate', async () => {
    await assertSucceeds(setDoc(general(alice()), config()));
    await assertFails(deleteDoc(general(alice())));
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
