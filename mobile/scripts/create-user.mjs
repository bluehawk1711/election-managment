#!/usr/bin/env node
/**
 * Creates one account and assigns it a role (plan-voters.md §7 fallback).
 *
 * The in-app flow (`hooks/useCreateAccount.ts`) needs an existing super admin,
 * which is a chicken-and-egg problem on a fresh project: `users` is empty, so
 * nobody can sign in to be a super admin. This script breaks that cycle using
 * the Admin SDK, whose IAM credentials bypass `firestore.rules` — which is
 * exactly why it is a script and not a screen.
 *
 *     pnpm run create:user -- --email you@example.com --role superAdmin
 *
 * Options
 *   --email <addr>        required
 *   --role <role>         karykarta | admin | superAdmin | developer  (default superAdmin)
 *   --ward <n>            required for karykarta, ignored for every other role
 *   --name <text>         displayName
 *   --password <text>     omit to have one generated and printed once
 *   --unverified          do NOT mark the email verified (default: verified,
 *                         so the account can sign in immediately)
 *   --adopt               the Auth user already exists (created in the Firebase
 *                         console, say) — leave its password alone and only
 *                         write/repair the `users` profile doc. Without this
 *                         flag an existing email is refused outright.
 *
 * The password can also come from `NEW_USER_PASSWORD`, which keeps it out of
 * your shell history and out of the process list — preferable on a shared
 * machine.
 *
 * Refuses to touch an email that already exists rather than silently resetting
 * somebody's password: that would hand a script the power to lock the real
 * owner out. Use the Firebase console (or delete the user there) if you
 * genuinely want to reset it — or pass `--adopt`, which keeps the existing
 * password and only writes the profile doc.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '..');

/** Must match `FIRESTORE_DATABASE_ID` in `lib/firebase.ts`. */
const FIRESTORE_DATABASE_ID = 'default';

/** Must match the `AppRole` union in `lib/roles.ts`. */
const ROLES = ['karykarta', 'admin', 'superAdmin', 'developer'];

/** Firebase's own minimum. Anything shorter is rejected by createUser anyway. */
const MIN_PASSWORD_LENGTH = 8;

function flag(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const value = process.argv[i + 1];
  if (value === undefined || value.startsWith('--')) {
    console.error(`✖ --${name} needs a value.`);
    process.exit(1);
  }
  return value;
}

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

async function main() {
  const email = flag('email')?.trim();
  const role = flag('role', 'superAdmin');
  const wardFlag = flag('ward');
  const displayName = flag('name');
  const verifyEmail = !process.argv.includes('--unverified');
  const adopt = process.argv.includes('--adopt');

  if (!email || !email.includes('@')) {
    console.error('✖ --email is required and must look like an address.');
    process.exit(1);
  }
  if (!ROLES.includes(role)) {
    console.error(`✖ --role must be one of: ${ROLES.join(', ')}`);
    process.exit(1);
  }

  // Only karykarta are ward-scoped. Storing `wardNo: null` for the other roles
  // would be harmless but misleading, and `Profile.wardNo` reads an absent
  // field as null anyway — so it is simply left out.
  const wardNo = role === 'karykarta' ? Number(wardFlag) : null;
  if (role === 'karykarta' && (!Number.isInteger(wardNo) || wardNo < 1)) {
    console.error('✖ --ward <n> is required for a karykarta (1..13 for this roll).');
    process.exit(1);
  }

  const projectId =
    process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ||
    dotEnv.EXPO_PUBLIC_FIREBASE_PROJECT_ID ||
    JSON.parse(readFileSync(path.join(ROOT, '.firebaserc'), 'utf8')).projects?.default;

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error(
      '✖ GOOGLE_APPLICATION_CREDENTIALS is not set.\n' +
        '  export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"\n'
    );
    process.exit(1);
  }

  initializeApp({ credential: applicationDefault(), projectId });
  const auth = getAuth();
  const db = getFirestore(FIRESTORE_DATABASE_ID);

  // 1. Refuse rather than reset. Resetting a password here would be a way to
  //    lock a real account owner out of their own project. `--adopt` is the
  //    escape hatch for the bootstrap case where the Auth user was made in the
  //    console and only the profile doc is missing.
  let existing = null;
  try {
    existing = await auth.getUserByEmail(email);
    if (!adopt) {
      console.error(
        `✖ ${email} already exists in ${projectId}.\n` +
          '  Not changing it. To reset the password, use the Firebase console:\n' +
          '    Authentication → Users → select the user → Reset password.\n' +
          '  To only grant it a role and leave the password alone, re-run with --adopt.\n'
      );
      process.exit(1);
    }
    console.log(`Adopting the existing Auth user ${existing.uid} (password untouched)`);
    // The profile doc mirrors the Auth displayName, so an adopted user given
    // --name needs both updated — otherwise the name shows up in Firestore and
    // nowhere else, and a later profile sync would wipe it.
    if (displayName && existing.displayName !== displayName) {
      existing = await auth.updateUser(existing.uid, { displayName });
      console.log(`  displayName set to "${displayName}"`);
    }
  } catch (caught) {
    // auth/user-not-found is the expected path here.
    if (caught?.code !== 'auth/user-not-found') throw caught;
  }

  let password = existing ? null : process.env.NEW_USER_PASSWORD || flag('password');
  const generated = !password;
  if (password !== null && password !== undefined) {
    if (password.length < MIN_PASSWORD_LENGTH) {
      console.error(
        `✖ Password must be at least ${MIN_PASSWORD_LENGTH} characters (Firebase's own minimum).`
      );
      process.exit(1);
    }
  } else if (!existing) {
    // Firebase requires >= 6; this generates 20 base64url chars, which clears
    // that and anything a password policy might add later.
    password = randomBytes(15).toString('base64url');
  }

  // 2. The Auth user, unless we adopted one.
  const user =
    existing ??
    (await auth.createUser({
      email,
      password,
      displayName: displayName ?? undefined,
      // Marked verified by default so a freshly seeded test account can sign in
      // without a detour through the inbox. `--unverified` opts out.
      emailVerified: verifyEmail,
    }));

  // 3. The profile. Same shape as `hooks/useCreateAccount.ts`, and
  //    `onboarded: true` because a role was assigned deliberately — there is
  //    nothing left for the onboarding flow to ask.
  await db
    .collection('users')
    .doc(user.uid)
    .set({
      email: user.email ?? null,
      displayName: user.displayName ?? null,
      photoURL: user.photoURL ?? null,
      onboarded: true,
      role,
      ...(wardNo != null ? { wardNo } : {}),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

  console.log(`\n✔ Created ${email} in ${projectId} (database "${FIRESTORE_DATABASE_ID}")\n`);
  console.log(`  uid        : ${user.uid}`);
  console.log(`  role       : ${role}${wardNo != null ? ` (ward ${wardNo})` : ''}`);
  console.log(`  verified   : ${verifyEmail}`);
  console.log(`  onboarded  : true — the app goes straight to the tabs\n`);
  console.log('  Sign in with:');
  console.log(`    email    : ${email}`);
  if (existing) {
    console.log('    password : unchanged (this account already existed)\n');
  } else {
    console.log(`    password : ${password}${generated ? '   (generated, shown once)' : ''}\n`);
    if (generated) {
      console.log('  Save it now — it is not stored anywhere and cannot be re-shown.\n');
    }
  }
  console.log('  The firestore.rules "role grant" path now allows this account to');
  console.log('  create others in-app from More → Accounts.\n');
}

main().catch((error) => {
  console.error(`\n✖ Could not create the account: ${error.message}\n`);
  process.exit(1);
});