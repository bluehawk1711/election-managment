# Voter Roll App — Build Plan (phase for `data/rajasthan/.../ward-*.csv`)

> Companion to `plan.md` (foundation/status live there). This plan covers **only**:
> roll data, roles, voter list/detail, booth report, account creation.
> Source data: `data/rajasthan/jodhpur/jhanwar/veernagar/ward-01..13.csv` (6855
> voters, 13 wards) + `wards-summary.csv` · extraction docs: `EXTRACTION.md`,
> `verification.md` · mocks: `stich_ui/voter_roll_restricted_access`,
> `stich_ui/users_and_permissions`, `stich_ui/import_voter_data_admin_flow`.
>
> **No data is inserted yet** — this document is the plan; seeding is a gated task (§9).

## 1. Scope

**In**

| # | Screen | Route |
|---|---|---|
| 1 | Voter list — ward selector, search *every* field, filters | `(tabs)/voters/index` |
| 2 | Voter detail — roll data + photo, location, voted flag, leaning, call/message, edit | `(tabs)/voters/[id]` |
| 3 | Edit sheet — local-only save, “pending sync” badge | `(tabs)/voters/edit.tsx` (modal) |
| 4 | Booth report — turnout/status per booth (karykarta scope) | `(tabs)/reports/index` |
| 5 | Accounts — super admin creates users + assigns role/scope | `(tabs)/more/users/*` |
| 6 | Role-aware shell — guards, role badge in Settings | existing screens |

**Out (unchanged from `plan.md`)**: dashboard/tasks/calendar/issues/expenses polish,
Cloud Functions, real sync, Google sign-in, PDF export. **Sync of edits = later phase**
(this plan only defines the local store + the shape sync will take).

## 2. Decisions already made

| Topic | Decision |
|---|---|
| Roll reads | **Dual source**: bundled JSON is default, Firestore a switch (`EXPO_PUBLIC_ROLL_SOURCE=bundle\|firestore`). One `RollSource` interface, two impls, no screen knows which. |
| Leaning values | 5-point spectrum `right, centerRight, center, centerLeft, left` + `unknown`, **plus a free-text note** (`leaningNote`). |
| Photos | **Compress hard → Cloudinary unsigned upload** (long edge ≤512 px, JPEG q≈0.35 ≈ 20–60 KB), store `secure_url` on the local overlay first. |
| Edits | **Never mutate the base roll.** All field edits land in a local overlay store; later sync writes to a *separate* Firestore collection, so the imported roll stays byte-identical to the CSVs. |
| Accounts | Super admin creates accounts from inside the app (Identity Toolkit REST, §7), then assigns role + scope. |

Flagged for your confirmation: §10.

## 3. What already exists — reuse, don’t rebuild

| Needed | Already in `mobile/` |
|---|---|
| Theme/tokens, EN+HI i18n, fonts | `theme/*`, `i18n/*` (add key groups `voters, reports, accounts`) |
| Auth + route guards (`Stack.Protected`) | `app/_layout.tsx`, `providers/auth-provider.tsx` |
| List chrome: search box, filter bar, chips, rows, skeletons, empty states, hierarchy picker | `components/campaign/{search-input,filter-bar,chip,list-row,skeleton,empty-state,section-header,hierarchy-picker,status-badge}.tsx` |
| Tab bar (animated, 5 slots) | `components/nav/*` |
| Firestore reads, filters, models | `hooks/useCollection.ts`, `lib/{filters,models,mappers,collections}.ts` (extend, keep pure/tested style) |
| Reference data (wards/booths) | `providers/reference-provider.tsx` |
| Rules + rule tests | `firestore.rules`, `rules-tests/` |
| Rules | `expo-location`, `expo-image-picker`, `expo-clipboard`, `expo-linking`, AsyncStorage, `lucide-react-native` |

**New deps installed this round:** `expo-image-manipulator` (compression),
`expo-file-system` (explicit — reading bundled JSON assets). Nothing else is required:
Cloudinary upload is a `fetch` POST, call/SMS/WhatsApp use `Linking`, search is
in-memory (6855 rows is trivial). Optional later: `@shopify/flash-list` if list
profiling shows jank.

## 4. Data architecture

```
            ┌── RollSource ─────────────────────────────┐
 screens ──►│ bundle: assets/data/*.rolljson (lazy)     │──► base roll (READ-ONLY)
            │ firestore: wards/voters collections       │
            └───────────────────────────────────────────┘
                                    +
            ┌── OverlayStore (AsyncStorage) ────────────┐
 detail ───►│ key  roll:overlay:{wardNo}  → {voterId: patch}│
 edit   ───►│ key  roll:queue              → sync ops      │──► local edits (WRITE)
            └───────────────────────────────────────────────┘
```

- **Base roll record** (from CSV, unchanged fields):
  `{ id, wardNo, serialNo, epicId, name, relation, fatherOrHusbandName, houseNo, age, gender, locality, pdfPage }`
  `id = 'w{wardNo}-{serialNo}'` (stable, human-debuggable; EPIC kept as a field + search key).
- **Overlay patch** (everything a user may add/change, never touches the base):
  `{ name?, fatherOrHusbandName?, houseNo?, age?, gender?, locality?, phone?, location?: {lat, lng, accuracy, address?}, photoUrl?, photoPublicId?, voted?: 'unknown'|'voted'|'notVoted', leaning?: 'right'|'centerRight'|'center'|'centerLeft'|'left'|'unknown', leaningNote?, note?, updatedAt, updatedBy }`
- **Read path** = base ⨯ overlay merge (overlay wins). Screen sees one `VoterView`.
- **Write path** = overlay only, plus a queue entry `{voterId, keys, updatedAt, uid}`
  so a future sync can push without re-deriving what changed.
- **Loading strategy (bundle source):** raw JSON is kept out of the JS bundle.
  Generate `assets/data/ward-01.rolljson` … `ward-13.rolljson` + `wards.rolljson`,
  add `rolljson` to `config.resolver.assetExts` in a new `metro.config.js`, load on
  ward select via `expo-asset` + `FileSystem.readAsStringAsync`, cache parsed ward in
  memory (LRU, keep ≤3 wards hot). Startup cost ≈ 0; largest ward is 826 rows.
- **Search**: one normalized haystack string per voter
  (`name father locality house epicId gender age serial ward booth relation` + overlay
  phone/leaning), case- and space-insensitive substring with token-AND fallback.
  Index built once per loaded ward; searching all wards loads them (they’re small).

## 5. Roles & permissions

`users/{uid}` gains two fields (rules updated in the same change):

```
role: 'karykarta' | 'admin' | 'superAdmin' | 'developer'
scope: { wardNo?: number, boothNo?: number }   // karykarta assignment
```

| Capability | karykarta | admin | superAdmin | developer |
|---|---|---|---|---|
| Voter list/detail (assigned ward only vs all) | own ward | all | all | all |
| Local edits, photo, location, voted flag | ✅ | ✅ | ✅ | ✅ |
| Booth report | own booth | all | all | all |
| Call / message voter (when phone exists) | ✅ | ✅ | ✅ | ✅ |
| Create accounts, assign role/scope | ❌ | ❌ | ✅ | ✅ |
| Data tools: reseed, sync push, diagnostics | ❌ | ❌ | ❌ | ✅ |
| Settings / profile / language | ✅ | ✅ | ✅ | ✅ |

Enforcement: **route guards** (`app/_layout.tsx` `Stack.Protected` + per-screen
`requireRole`) for UX; **`firestore.rules`** server-side via
`get(/users/$(uid)).data.role` helper functions (`roleAtLeast('admin')` etc.).
New role logic lives in `lib/roles.ts` (pure, unit-tested: `can(role, action, scope)`).

## 6. Screens (only these)

1. **Voter list** — top: ward selector (horizontal chips 1..13 + “All”, counts) ·
   search input (every field) · filter sheet (gender, age band, voted, leaning,
   has-photo, has-phone) · `FlatList` rows: name + `epicId` + house/locality +
   badges (voted ✓, leaning, photo) · empty/loading/error states from the existing
   campaign components · matches `stich_ui/voter_roll_restricted_access`.
2. **Voter detail** — header (name, EPIC, ward/serial) · 2 photo (tap = pick →
   compress → upload → overlay) · location card (accuracy + “Open in Maps” via
   `Linking`) · voted toggle (segmented) · leaning selector (5 options) + note ·
   contact row: `tel:`, `sms:`, `whatsapp://send?phone=` — **hidden while `phone`
   is empty** (the roll contains no phone numbers; add one via edit) · edit button →
   sheet · “edited locally — pending sync” badge · `pdf_page` shown for traceability.
3. **Edit sheet** — modal form over the editable subset (name, father/husband,
   house, age, gender, locality, phone, note) with validation mirroring the CSV
   ranges (age 18–100), Save = overlay write + queue push, toast, no network call.
4. **Booth report** — per booth/ward card: total voters, voted / notVoted / unknown,
   turnout %, photos added, edits pending, mini progress rail (existing
   `progress-rail`), tap-through to the filtered voter list. Karykarta sees only
   `scope.wardNo`.
5. **Accounts (super admin)** — list of team members (existing `teamMembers` hook)
   + create form (name, email, password, role, ward/booth scope) → §7; inline
   role change + disable. Matches `stich_ui/users_and_permissions`.
6. **Shell** — role badge in Settings, role-gated entries in the More hub.

**Navigation proposal (flagged, §10):** tabs become **Home · Voters · Booths ·
Reports · More**; Tasks & Calendar stay as routes but move under More.

## 7. Account creation (super admin, in-app)

Client-side Auth SDK cannot create arbitrary users, so creation goes through the
Identity Toolkit REST endpoint with the existing public web key
(`EXPO_PUBLIC_FIREBASE_API_KEY`, already in `.env` — it identifies the project,
it does not grant rights; Firestore rules still decide everything):

1. `POST identitytoolkit.googleapis.com/v1/accounts:signUp {email, password, returnSecureToken:true}`
2. On `localId`, write `users/{localId} {role, scope, displayName, onboarded:true, …}` —
   rules allow this **only** when the caller is `superAdmin`/`developer`.
3. Show the credentials once for hand-over (never store the password).
4. Fallback if the REST path is undesired: `scripts/create-user.mjs` with
   `service-account.json` (Admin SDK) — same `users` doc shape.

Rules change in the same PR: `users` create allowed for owner **or** superAdmin;
`role`/`scope` in the owner-writable key list only for superAdmin/developer; add
`roleAtLeast()` helpers. `rules-tests/` extended accordingly.

## 8. Photo → Cloudinary

- Env (add to `.env.example`): `EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME`,
  `EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET` (unsigned preset, restricted to
  image/jpeg+png and a `voter-photos/` folder).
- Flow: `expo-image-picker` → `ImageManipulator.manipulate(uri)`
  → resize `width: 512` (keep aspect) → `renderAsync().saveAsync({format: JPEG, quality: 0.35})`
  → `fetch('https://api.cloudinary.com/v1_1/<cloud>/image/upload', {method:'POST', body: form(upload_preset + file)})`
  → `{secure_url, public_id}` → overlay. Upload failures keep the local file path so
  it retries after sync.

## 9. Phases (each ends green on the gate in §11)

- **V0 · Data prep (no insertion)** — `scripts/build-roll.mjs` converts the 13 CSVs
  + summary into `mobile/assets/data/*.rolljson`; `metro.config.js` asset ext;
  importer unit-tested (row counts = 6855, gender tallies match covers, id uniqueness).
- **V1 · Roll source + overlay store** — `lib/roll/{source,bundle-source,firestore-source,search,overlay}.ts`,
  `hooks/useRoll.ts`, `hooks/useVoterOverlay.ts`; tests for merge, search, queue.
- **V2 · Voter list + detail + edit sheet** — screens in §6.1–6.3, i18n keys,
  empty/loading/error states, badges.
- **V3 · Photo, location, contact** — Cloudinary helper, location picker, `tel/sms/whatsapp`.
- **V4 · Roles** — `lib/roles.ts`, guards, Settings badge, rules + rule tests.
- **V5 · Reports** — booth report screen with voted/turnout rollups.
- **V6 · Accounts** — super admin creation flow (§7) + team list.
- **V7 · Seed gate (explicit go-ahead)** — `scripts/seed-roll.mjs` (firebase-admin,
  batched 500/write) → `wards` + `voters`; switch `EXPO_PUBLIC_ROLL_SOURCE` to
  `firestore` only after counts verified against `wards-summary.csv`.

## 10. Needs your call

1. **Tabs** — my proposal (Voters + Reports as tabs, Tasks/Calendar under More) vs. keep the current 5 and put Voters under More.
2. **Leaning visibility** — private to each user (as now) or shared across the team when sync lands? Same question for edited field values.
3. **Karykarta scope granularity** — the roll is one booth per ward, so `scope.wardNo` is enough; confirm.
4. **Cloudinary** — need cloud name + unsigned preset (2 env vars) before V3.
5. **Account creation** — in-app REST (§7) vs. CLI script with the service account.

## 11. Verification gate (every phase)

`pnpm exec tsc --noEmit` → `pnpm lint` → `pnpm test` (new: roll importer, overlay
merge, search, `lib/roles`) → `pnpm run rules:test` whenever rules change →
`pnpm exec expo config --type public` → per-screen check against the `stich_ui`
mocks. Hard product invariants: **base roll never written by the app** (asserted in
tests + read-only rules) and **6855 rows / ward tallies match the CSVs** after any
import.
