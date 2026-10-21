# Expo + Firebase + Auth

An [Expo](https://expo.dev) app with [BNA UI](https://ui.ahmedbna.com) and a
[Firebase](https://firebase.google.com) backend — email/password sign-in,
Google and Apple, Realtime Database with claim-based security rules, Cloud
Storage avatars, and live probes that exercise those rules as real accounts.

Scaffolded with:

```bash
npx bna-ui firebase my-app
```

## Setup

<!-- prettier-ignore -->
1. **Create a project** at [console.firebase.google.com](https://console.firebase.google.com),
   then add a **Web** app to it (the `</>` icon). Enable **Realtime Database**,
   Storage and Authentication from the console's Build menu. (Firestore is not
   used by the app any more.)

2. **Turn on Email/Password** under Authentication → Sign-in method. That is
   the only provider needed to run the app.

3. **Add your config.** Copy `.env.example` to `.env.local` and fill in the
   seven `EXPO_PUBLIC_FIREBASE_*` values from Project settings → General → Your
   apps. One of them is easy to miss: `EXPO_PUBLIC_FIREBASE_DATABASE_URL` is the
   Realtime Database **URL** (Build → Realtime Database, shown at the top), not
   a database id. Without it the app builds and signs in, then fails on its
   first read.

4. **Name your project** in `.firebaserc`, replacing `your-project-id`.

5. **Deploy the rules.** Nothing loads until you do:

   ```bash
   npx firebase-tools deploy --only database,storage
   ```

6. **Run it.**

   ```bash
   npm start
   ```

> **Building in CI?** The workflows in `.github/workflows/` write `mobile/.env`
> from repository secrets, so each required key needs a secret with the same
> name: `EXPO_PUBLIC_FIREBASE_API_KEY`, `…_AUTH_DOMAIN`, `…_PROJECT_ID`,
> `…_STORAGE_BUCKET`, `…_MESSAGING_SENDER_ID`, `…_APP_ID` and
> `EXPO_PUBLIC_FIREBASE_DATABASE_URL`. `…_LINK_URL` and the
> `EXPO_PUBLIC_GOOGLE_*_CLIENT_ID`s are optional. Every build starts with a
> guard step that fails if a required value would be bundled empty — a missing
> database URL otherwise ships an app that installs, signs in, and then cannot
> read anything.

Email and password sign-in, the Realtime Database and Storage all work in Expo
Go. Google and Apple do not — see below.

## What's here

```
providers/auth-provider.tsx  onAuthStateChanged + users/{uid} listener + deep links
app/_layout.tsx              three Stack.Protected groups: (auth), (onboarding), (tabs)
app/(auth)/
├── sign-in.tsx              password + OAuth buttons
├── sign-up.tsx              create → updateProfile → sendEmailVerification
├── forgot-password.tsx      sendPasswordResetEmail
├── reset-password.tsx       verifyPasswordResetCode + confirmPasswordReset
└── email-link.tsx           sendSignInLinkToEmail (off unless configured)
lib/
├── firebase.ts              app + auth (persisted) + Realtime Database + Storage
├── large-secure-store.ts    AES + Keychain, because Firebase's user record > 2 KB
├── documents.ts             pure: profile snapshot → plain object
├── auth-link.ts             pure: parse an incoming Firebase action URL
└── errors.ts                pure: Firebase error code → prose
hooks/                       useTasks, useProfile, useAvatarUpload, useDeleteAccount
database.rules.json          the boundary. Read this one properly
storage.rules                avatars/<uid>/… and files/<uid>/…
scripts/                     seed/import tools + live probes (probe-writes, verify-live)
```

## Sign-in methods

| Method             | Works in Expo Go   | Setup                                             |
| ------------------ | ------------------ | ------------------------------------------------- |
| Email and password | Yes                | Enable the provider. Nothing else.                |
| Password reset     | Yes                | Works out of the box, via Firebase's hosted page. |
| Google             | **No — dev build** | Three OAuth client IDs. See `.env.example`.       |
| Apple              | **No — dev build** | Enable the provider; iOS only.                    |
| Email link         | **No — dev build** | A Hosting link domain plus associated domains.    |

Two things a Supabase project has that this does not:

- **No email OTP.** Firebase Authentication has no six-digit email code — the
  only OTP it offers is SMS, which needs a browser-only reCAPTCHA verifier and
  costs money per message. There is no `verify-otp.tsx` here as a result.
- **No GitHub.** `GithubAuthProvider.credential` needs an access token obtained
  with a client _secret_, which cannot ship in an app bundle. Supabase does that
  exchange on its own servers; Firebase expects you to.

### Why Google and Apple need a development build

`signInWithPopup` and `signInWithRedirect` throw
`auth/operation-not-supported-in-this-environment` on React Native, so the only
route is a native ID token fed to `signInWithCredential`. And
`expo-auth-session`'s hosted proxy was removed in SDK 48, so under Expo Go the
redirect is `exp://…`, which no Google OAuth client type accepts.

```bash
npx expo run:ios      # or run:android, or an EAS development build
```

Before an EAS build you also need `ios.bundleIdentifier` and `android.package`
in `app.json` — the Google iOS and Android OAuth clients are tied to them.

With no client IDs set, the OAuth buttons render nothing at all rather than
failing when pressed. That is deliberate.

### Email links and in-app password reset

Both are off by default and both work fine that way: the reset link opens
Firebase's hosted page, the user sets a password, and comes back to sign in.

To bring them into the app instead, set `EXPO_PUBLIC_FIREBASE_LINK_URL` and
claim the domain natively. **Firebase Dynamic Links shut down on 25 August
2025**, so the old `page.link` bounce no longer exists — the supported approach
is a Firebase Hosting domain plus Universal Links / App Links:

```jsonc
// app.json
"ios":     { "associatedDomains": ["applinks:your-project-id.firebaseapp.com"] },
"android": { "intentFilters": [{
  "action": "VIEW", "autoVerify": true,
  "data": [{ "scheme": "https", "host": "your-project-id.firebaseapp.com" }],
  "category": ["BROWSABLE", "DEFAULT"]
}] }
```

These are not in `app.json` already because a placeholder host claims nothing,
and because the CLI writes `expo.scheme` as a string when it scaffolds. Both are
native entitlements, so this needs a build — it cannot work in Expo Go.

## Accounts and roles

A Firebase Auth account is only half an account. The UI reads capabilities from
the `users/{uid}` profile, and the rules read the `role` **custom claim**;
`scripts/grant-claims.mjs` mirrors the profile onto the token. **No role means
no capabilities** in either place — a user with no profile sees nothing but the
no-role empty state.

That creates a bootstrap problem: `users` starts empty, so nobody can sign in to
*be* a super admin, and the in-app **More → Accounts** flow (the normal way to
add people) needs an existing super admin. Break the cycle with the Admin SDK,
whose IAM credentials bypass the rules — which is exactly why this is a script
and not a screen:

```bash
export GOOGLE_APPLICATION_CREDENTIALS="$PWD/service-account.json"

pnpm run create:user -- --email you@example.com --role superAdmin
```

Omit `--password` and one is generated and printed **once**. Pass
`NEW_USER_PASSWORD=...` instead of `--password` to keep it out of your shell
history. The script writes the profile **and** the matching custom claim, so the
account can use the app immediately. Then sign in as that account and use
**More → Accounts** for everyone after it.

| Flag | Notes |
|------|-------|
| `--email` | required |
| `--role` | `karykarta` \| `admin` \| `superAdmin` \| `developer` (default `superAdmin`) |
| `--ward <n>` | **required for `karykarta`** — ignored for every other role |
| `--name <text>` | `displayName`, set on both the Auth user and the profile |
| `--password <text>` | omit to have one generated |
| `--unverified` | leave the email unverified (default: verified, so it can sign in at once) |
| `--adopt` | the Auth user already exists — grant it a role and leave the password alone |

`--adopt` covers the other bootstrap case: you made the user in the Firebase
console and only the profile node is missing. **Without** `--adopt` the
script refuses to touch an existing email rather than resetting its password,
because a script that can silently reset a password can lock a real account
owner out of their own project. Reset it deliberately in the console instead
(Authentication → Users → Reset password).

Check what an account actually ended up with — Auth record, custom claims,
profile node, and whether the password really signs in:

```bash
pnpm exec node scripts/check-account.mjs you@example.com 'the-password'
```

The voter roll is **bundled** with the app (`lib/roll/`), so the ~7,000 records
are never downloaded; RTDB only carries the edits people make. The legacy
Firestore copy can still be imported once with:

```bash
pnpm run seed:rtdb -- --dry-run   # report what would be written
pnpm run seed:rtdb                # import the backup into RTDB
```

`seed:roll` / `verify:roll` are migration-only tools that read/write the old
Firestore backup; the app does not use them.

Note that the Firebase CLI cannot import data. `firebase login` holds a **user**
OAuth token, and RTDB evaluates `database.rules.json` against it — `voters` is
not client-writable, so a CLI- or REST-based import is denied. Only IAM
(service account) credentials bypass the rules.

## Security rules

`database.rules.json` is the boundary. The route guards in `app/_layout.tsx` are
a convenience; a modified client ignores them and the rules still hold.

**Two things to internalise, both different from Firestore:**

1. **Rules cannot read another path.** A rule at `/tasks` cannot ask "is this
   caller an admin?" by reading `/users/{uid}`. The answer has to be on the
   token, so authority lives in **custom claims** (`role`, `wardNo`, `teamId`,
   `locked`, `multiDevice`). The profile is the human-editable copy; the claim
   is what the rules enforce. `scripts/grant-claims.mjs` — and the admin panel's
   claims route — mirror one onto the other, and a token picks up a change on
   its next refresh (up to an hour, without signing anyone out).
2. **There are no queries to prove.** A read rule grants a whole node, not a
   filtered result. `useCollection` therefore downloads the node and filters,
   sorts and limits in memory. That is fine at campaign scale (a few hundred
   tasks or events), and it is why `voters` deliberately has **no**
   collection-level read: the roll is bundled, and only `voters/{id}` inside the
   caller's ward is readable. `/voters` returning `PERMISSION_DENIED` is correct.

Deploy and verify against the live project:

```bash
npm run deploy:rules
npm run verify:live -- you@example.com
npm run probe:owner
npm run probe:writes
```

`verify:live` asserts the deny side as deliberately as the allow side.
`probe:writes` creates and deletes one of every document the app writes — a
task, an event, an issue, an expense, a compliance item, a phone proposal — as a
real karykarta and super admin, then checks the device-binding and lock paths.
A rules file that is merely permissive fails those probes.

## Account deletion

`hooks/useDeleteAccount.ts` deletes tasks, then the avatar, then the profile
node, then the auth record — in that order, so a failure part-way leaves a
usable account rather than orphaned data.

It is **best-effort**. RTDB has no `ON DELETE CASCADE`, and this runs on the
user's device, so a crash mid-way leaves nodes behind. The robust version is
server-side: Firebase's official "Delete User Data" extension, or a Cloud
Function on the `user.delete` trigger. Neither ships here because Cloud
Functions require the paid Blaze plan and a starter should not.

**Known gap:** `database.rules.json` deliberately refuses self-deletion of
`users/{uid}` (only an account manager may delete a profile), so the profile
step is denied and the flow aborts before the Auth record is removed. The
screen exists but cannot complete; deleting an account currently needs an admin
in the Firebase console.

Deletion also needs a recent sign-in (`auth/requires-recent-login`), which is
what the password prompt in the confirm dialog is for.

## Local development

```bash
npm run emulators                          # UI at http://localhost:4000
```

Then set `EXPO_PUBLIC_FIREBASE_USE_EMULATOR=1` in `.env.local`. The app reads
the dev server's LAN address from Expo, so this works from a real device too.
The emulators are Java processes — firebase-tools 15 needs JDK 21 or newer.

## Things worth knowing

- **Sessions persist through `LargeSecureStore`.** Firebase's user record runs
  past `expo-secure-store`'s 2 KB limit once `providerData` holds a Google
  identity, so the AES key goes in the Keychain and the ciphertext in
  AsyncStorage. Read the comment in that file before replacing it.
- **`serverTimestamp()` is a sentinel locally** (`{'.sv': 'timestamp'}`) until
  the server acknowledges the write and echoes a number. `millisOf` in
  `lib/documents.ts` treats the sentinel as `null`; your own mappers must too.
- **A new user is signed in immediately, verified or not.** There is no blocked
  state; a card in Settings does the nagging. Gate the `(tabs)` guard on
  `user.emailVerified` if you want verification to be mandatory.
- **There is no offline disk cache.** RTDB keeps values in memory only; the
  bundled roll is on disk, and edits are queued in AsyncStorage
  (`lib/roll/overlay.ts`).
- **Search matches whole words.** There is no server-side `LIKE`.
- **No config plugin, no `google-services.json`.** The Firebase JS SDK is pure
  JavaScript. That changes if you move to `@react-native-firebase`.

## Learn more

- [Starter documentation](https://ui.ahmedbna.com/docs/installation/firebase-auth)
- [Authentication](https://ui.ahmedbna.com/docs/firebase/auth) ·
  [Google](https://ui.ahmedbna.com/docs/firebase/google) ·
  [Apple](https://ui.ahmedbna.com/docs/firebase/apple)
- [Security rules](https://ui.ahmedbna.com/docs/firebase/rules) ·
  [Realtime Database](https://firebase.google.com/docs/database) ·
  [Storage](https://ui.ahmedbna.com/docs/firebase/storage)
- [Firebase documentation](https://firebase.google.com/docs)
