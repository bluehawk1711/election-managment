import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** storage.rules, actually executed. The RTDB rules are covered by scripts/probe-writes.mjs. */

const ALICE = 'uid-alice';
const BOB = 'uid-bob';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'bna-rules-test',
    storage: {
      rules: readFileSync(
        path.resolve(__dirname, '..', 'storage.rules'),
        'utf8'
      ),
      host: '127.0.0.1',
      port: 9199,
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearStorage();
});

const alice = () => testEnv.authenticatedContext(ALICE).storage();
const bob = () => testEnv.authenticatedContext(BOB).storage();
const anon = () => testEnv.unauthenticatedContext().storage();

const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const image = { contentType: 'image/png' };

describe('/avatars/{uid}', () => {
  it('lets a user write under their own uid', async () => {
    await assertSucceeds(
      uploadBytes(ref(alice(), `avatars/${ALICE}/avatar.png`), png(), image)
    );
  });

  it('denies writing under someone else’s uid', async () => {
    // The uid path segment is the whole access check — exactly as
    // `(storage.foldername(name))[1] = auth.uid()::text` is in a Supabase
    // policy. This is why useAvatarUpload builds the path from user.uid.
    await assertFails(
      uploadBytes(ref(bob(), `avatars/${ALICE}/avatar.png`), png(), image)
    );
  });

  it('is readable only by its owner', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await uploadBytes(
        ref(context.storage(), `avatars/${ALICE}/avatar.png`),
        png(),
        image
      );
    });

    await assertSucceeds(getBytes(ref(alice(), `avatars/${ALICE}/avatar.png`)));
    // This used to be `allow read: if true`, on the reasoning that an avatar is
    // innocuous and shows up next to a name. Here it is not: these are the
    // faces of named people attached to a named constituency, and a
    // world-readable path means the whole roster can be pulled by anyone who
    // can guess the bucket name.
    //
    // Another signed-in user cannot read it either, and that is the assertion
    // that would break first if a roster avatar is ever added — the rule and
    // this test change together, deliberately.
    await assertFails(getBytes(ref(bob(), `avatars/${ALICE}/avatar.png`)));
    await assertFails(getBytes(ref(anon(), `avatars/${ALICE}/avatar.png`)));
  });

  it('rejects a non-image and an oversized file', async () => {
    await assertFails(
      uploadBytes(ref(alice(), `avatars/${ALICE}/a.pdf`), png(), {
        contentType: 'application/pdf',
      })
    );
    await assertFails(
      uploadBytes(
        ref(alice(), `avatars/${ALICE}/big.png`),
        new Uint8Array(3 * 1024 * 1024),
        image
      )
    );
  });

  it('allows the owner to delete, despite the size condition on create', async () => {
    // The trap this asserts against: `write` covers delete, and on a delete
    // `request.resource` is null — so a combined
    // `allow write: if … request.resource.size < N` silently denies every
    // delete. The rules split create/update from delete for this reason, and
    // useDeleteAccount depends on it working.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await uploadBytes(
        ref(context.storage(), `avatars/${ALICE}/avatar.png`),
        png(),
        image
      );
    });

    await assertFails(deleteObject(ref(bob(), `avatars/${ALICE}/avatar.png`)));
    await assertSucceeds(
      deleteObject(ref(alice(), `avatars/${ALICE}/avatar.png`))
    );
  });
});

describe('/files/{uid}', () => {
  it('is private, exactly like avatars now are', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await uploadBytes(
        ref(context.storage(), `files/${ALICE}/notes.txt`),
        png()
      );
    });

    await assertSucceeds(getBytes(ref(alice(), `files/${ALICE}/notes.txt`)));
    await assertFails(getBytes(ref(bob(), `files/${ALICE}/notes.txt`)));
    await assertFails(getBytes(ref(anon(), `files/${ALICE}/notes.txt`)));
  });
});

describe('paths outside the two prefixes', () => {
  it('are denied even for a signed-in user', async () => {
    await assertFails(
      uploadBytes(ref(alice(), 'elsewhere/a.png'), png(), image)
    );
  });
});
