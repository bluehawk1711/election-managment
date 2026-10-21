# Expo + Firebase + Auth

An [Expo](https://expo.dev) app with [BNA UI](https://ui.ahmedbna.com) and a
[Firebase](https://firebase.google.com) backend — email/password sign-in,
Google and Apple, Cloud Firestore scoped per user, Cloud Storage avatars, and
security rules with tests that actually run them.

Scaffolded with:

```bash
npx bna-ui firebase my-app
```

## Setup

<!-- prettier-ignore -->
1. **Create a project** at [console.firebase.google.com](https://console.firebase.google.com),
   then add a **Web** app to it (the `</>` icon). Enable **Realtime Database**,
   Storage and Authentication from the console's Build menu. (Firestore is not
   used by the app any more — see "Where the data lives" below.)

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
├── firebase.ts              app + auth (persisted) + Firestore + Storage
├── large-secure-store.ts    AES + Keychain, because Firebase's user record > 2 KB
├── documents.ts             pure: snapshot → plain object, byNewest, tokenize
├── auth-link.ts             pure: parse an incoming Firebase action URL
└── errors.ts                pure: Firebase error code → prose
hooks/                       useTasks, useProfile, useAvatarUpload, useDeleteAccount
firestore.rules              owner-only. Read this one properly
storage.rules                avatars/<uid>/… and files/<uid>/…
rules-tests/                 the rules, executed against the emulator
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

A Firestore Auth account is only half an account. Capabilities come from a
`users/{uid}` document, and **no role means no capabilities** — that is
deliberate, in the app and in `firestore.rules` alike. A user with no profile
document can sign in and then see nothing but the no-role empty state.

That creates a bootstrap problem: `users` starts empty, so nobody can sign in to
*be* a super admin, and the in-app **More → Accounts** flow (which is the normal
way to add people) needs an existing super admin. Break the cycle with the
Admin SDK, whose IAM credentials bypass the rules — which is exactly why this
is a script and not a screen:

```bash
export GOOGLE_APPLICATION_CREDENTIALS="$PWD/service-account.json"

pnpm run create:user -- --email you@example.com --role superAdmin
```

Omit `--password` and one is generated and printed **once**. Pass
`NEW_USER_PASSWORD=...` instead of `--password` to keep it out of your shell
history. Then sign in as that account and use **More → Accounts** for everyone
after it.

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
console and only the profile document is missing. **Without** `--adopt` the
script refuses to touch an existing email rather than resetting its password,
because a script that can silently reset a password can lock a real account
owner out of their own project. Reset it deliberately in the console instead
(Authentication → Users → Reset password).

Check what an account actually ended up with — Auth record, profile document,
and whether the password really signs in:

```bash
pnpm exec node scripts/check-account.mjs you@example.com 'the-password'
```

The roll itself is seeded separately, and verified the same way:

```bash
pnpm run seed:roll -- --dry-run   # parse + validate, writes nothing
pnpm run seed:roll                # refuses if `voters` already has data
pnpm run verify:roll              # read-only; per ward and per gender
```

Note that the Firebase CLI cannot do any of this. `firebase login` holds a
**user** OAuth token, and Firestore evaluates `firestore.rules` against any
request carrying an end-user identity — the rules make `voters` and `wards`
read-only from clients, so a CLI- or REST-based import is denied. Only IAM
(service account) credentials bypass the rules.

## Security rules

`firestore.rules` is the boundary. The route guards in `app/_layout.tsx` are a
convenience; a modified client ignores them and the rules still hold.

**The one thing to internalise, especially coming from Postgres row level
security:** a read rule is evaluated against the _query_, not against the
documents it would return. Firestore refuses any query it cannot prove in
advance is limited to documents the rule allows. So this:

```ts
query(collection(db, 'tasks'), orderBy('createdAt', 'desc'));
```

fails with `permission-denied` even for a signed-in user. It does not quietly
return only your own rows the way an RLS policy would. That is why
`hooks/useTasks.ts` and the search screen both carry
`where('ownerId', '==', uid)`, and why removing it breaks the screen outright.

Run the rules:

```bash
npm run rules:test   # starts the emulators, executes rules-tests/, stops them
```

Needs a JDK 21 or newer on your PATH — the emulators are Java processes, and
firebase-tools 15 refuses to start on anything older.

## Account deletion

`hooks/useDeleteAccount.ts` deletes tasks, then the avatar, then the profile
document, then the auth record — in that order, so a failure part-way leaves a
usable account rather than orphaned data.

It is **best-effort**. Firestore has no `ON DELETE CASCADE`, and this runs on
the user's device, so a crash mid-way leaves documents behind. The robust
version is server-side: Firebase's official "Delete User Data" extension, or a
Cloud Function on the `user.delete` trigger. Neither ships here because Cloud
Functions require the paid Blaze plan and a starter should not.

Deletion also needs a recent sign-in (`auth/requires-recent-login`), which is
what the password prompt in the confirm dialog is for.

## Local development

```bash
npm run emulators                          # UI at http://localhost:4000
npm run emulators:seed -- --uid <your-uid>
```

Then set `EXPO_PUBLIC_FIREBASE_USE_EMULATOR=1` in `.env.local`. The app reads
the dev server's LAN address from Expo, so this works from a real device too.

## Things worth knowing

- **Sessions persist through `LargeSecureStore`.** Firebase's user record runs
  past `expo-secure-store`'s 2 KB limit once `providerData` holds a Google
  identity, so the AES key goes in the Keychain and the ciphertext in
  AsyncStorage. Read the comment in that file before replacing it.
- **`serverTimestamp()` reads as `null` locally** until the server acknowledges
  the write. `lib/documents.ts` handles it; your own mappers must too.
- **A new user is signed in immediately, verified or not.** There is no blocked
  state; a card in Settings does the nagging. Gate the `(tabs)` guard on
  `user.emailVerified` if you want verification to be mandatory.
- **There is no offline disk cache.** Firestore's persistent cache is IndexedDB,
  which React Native does not have.
- **Search matches whole words.** Firestore has no `LIKE`.
- **No config plugin, no `google-services.json`.** The Firebase JS SDK is pure
  JavaScript. That changes if you move to `@react-native-firebase`.

## Learn more

- [Starter documentation](https://ui.ahmedbna.com/docs/installation/firebase-auth)
- [Authentication](https://ui.ahmedbna.com/docs/firebase/auth) ·
  [Google](https://ui.ahmedbna.com/docs/firebase/google) ·
  [Apple](https://ui.ahmedbna.com/docs/firebase/apple)
- [Security rules](https://ui.ahmedbna.com/docs/firebase/rules) ·
  [Firestore](https://ui.ahmedbna.com/docs/firebase/firestore) ·
  [Storage](https://ui.ahmedbna.com/docs/firebase/storage)
- [Firebase documentation](https://firebase.google.com/docs)
