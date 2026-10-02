# Election Campaign Management App — Build Plan

> Expo (RN) + Firebase prototype. Blueprint: `mobile/Election_Campaign_Management_App_Blueprint.pdf`
> Design system: `DESIGN.md` (root) · Screen mocks: `stich_ui/<screen>/{code.html,screen.png}`
> Working dir: `mobile/` · Repo root: this folder (git + `.github` here)

## 1. Agreed scope

Core 7 modules, premium, auth-gated, EN + HI, full filtering + CRUD, manual seed.

| # | Module | Mock in `stich_ui/` |
|---|---|---|
| 1 | Candidate Dashboard | `campaign_dashboard_light`, `campaign_dashboard_dark` |
| 2 | Voter Roll + Booth hierarchy (Constituency → Ward → Area → Booth → Voter) | `voter_roll_restricted_access`, `booths_management`, `booth_118_detail`, `import_voter_data_admin_flow` |
| 3 | Team Management | `team_management` |
| 4 | Field Tasks | `tasks`, `task_detail`, `create_task_modal` |
| 5 | Public/Civic Issues | `public_issues`, `report_issue_modal_full_height` |
| 6 | Campaign Calendar | `campaign_calendar` |
| 7 | Expenses & Compliance | (expense rows follow card/telemetry spec in DESIGN.md) |
| — | More hub + Settings | `more_settings_hub`, `campaignos_login_screen`, `notifications` |

**Out of scope:** political profiling of voters (hard-blocked in rules), CSV import (seed does it), OTP/MFA/audit logs, Cloud Functions, PDF export, AI content, Admin Panel, Election-Day Command Center, Google/Apple sign-in (needs dev build; email/password works in Expo Go).

## 2. Hard constraints (user)

1. **Every component < 500 LOC** — split into separate files, reuse primitives aggressively.
2. **Global theme / design system** — all tokens in `theme/`, nothing hard-coded in screens.
3. **Animated tab bar** matching the mock: floating frosted pill, animated active indicator, icon/label morph (reanimated).
4. **More animated components later** — animation helpers must be centralized/reusable (`lib/animation.ts`, `components/anim/*`).
5. **Firebase credentials later** — code against `EXPO_PUBLIC_FIREBASE_*` env; nothing may crash before `.env.local` exists (provide `.env.local` from `.env.example` when creds arrive). Seed targets **real Firestore** only (service account via `GOOGLE_APPLICATION_CREDENTIALS`).
6. Hindi + English everywhere (i18next + react-i18next + expo-localization; Noto Sans Devanagari bundled with Inter).

## 3. Tech decisions

- **Stack:** Expo SDK 57, expo-router, RN 0.86, Firebase JS SDK v12 (auth/firestore/storage), BNA UI (`components/ui/*`, vendored), reanimated 4, expo-blur, expo-image, lucide-react-native.
- **New deps:** `i18next`, `react-i18next`, `expo-localization`, `@expo-google-fonts/inter`, `@expo-google-fonts/noto-sans-devanagari` · dev: `firebase-admin`.
- **Data scoping:** one shared campaign — every signed-in user reads/writes the same campaign collections; `users/{uid}` stays owner-only (starter rules kept).
- **Filtering:** equality-only Firestore queries + in-memory multi-criteria filtering (`lib/filters.ts`, pure + unit-tested) → no composite-index explosion; `firestore.indexes.json` emptied.
- **Forms:** modal stack screens (`presentation: 'modal'`) per tab; confirm deletes via `AlertDialog`; success via `Toast`.
- **Identity:** single source `constants/brand.ts` → consumed by `app.config.ts` (name/slug/scheme/package/bundleIdentifier) and in-app About. Name `Election Campaign` (logo/display name swap pending) · package/bundle id **`com.campaignos.app`** (matches `mobile/google-services.json`, wired via `android.googleServicesFile`).

## 4. Firestore data model (all top-level, shared)

```
campaigns/active     name, candidateName, constituencyName, electionDate, tagline, updatedAt
constituencies       name, code
wards                name, constituencyId
areas                name, wardId, constituencyId
booths               number, name, areaId, wardId, constituencyId, address, estimatedVoters, coordinatorId
voters               rollId, name, gender, age, houseNo, mobile, boothId, areaId, wardId, constituencyId
teamMembers          name, phone, role(coordinator|worker), areaId?, boothId?, status(active|inactive)
tasks                title, description, assigneeId, areaId?, boothId?, dueDate,
                     status(pending|in_progress|completed|issue), report?, createdBy, createdAt, updatedAt
issues               category(road|water|electricity|drainage|streetlight|sanitation), title, description,
                     areaId, photoUrl?, status(open|in_progress|resolved), reportedBy, reportedAt
events               title, type(meeting|training|public|deadline), startsAt, endsAt?, location, description
expenses             date, category, amount, description, receiptUrl?, status(pending|approved|rejected), createdAt
compliance           title, category, status(done|pending|attention), dueDate?, notes
users/{uid}          UNCHANGED (owner-only): email, displayName, photoURL, onboarded, timestamps
```

Rules: `signedIn()` for campaign collections + enum/range validation; voters may **never** carry `party|preference|votedFor|support` keys; `users` rules verbatim from starter; `rules-tests/` updated to match.

## 5. i18n

- `i18n/index.ts` (init, AsyncStorage persistence, device-locale detect via expo-localization), `i18n/locales/en.ts` + `hi.ts` (`as const` → derived `TranslationKey`, typed `t()`).
- Key groups: `common, nav, auth, onboarding, dashboard, voters, booths, team, tasks, issues, calendar, expenses, compliance, more, settings, filters`.
- Language switch: Settings segmented pill `EN | हिं` + onboarding step.
- `lib/format.ts`: `Intl` dates/numbers (`en-IN`/`hi-IN`, ₹), unit-tested.

## 6. Design system mapping (`DESIGN.md` → `theme/`)

| DESIGN.md | token |
|---|---|
| bg `#F6F7FB` / `#0B0D14` | `background` |
| card `#FFFFFF` / `#141824` | `card` + `cardForeground` |
| border `#E4E7F0` / `#262C3F` | `border`, `input` |
| text `#0F1222` / `#F2F4FA` | `text`, `foreground` |
| secondary text `#5B6178` / `#9AA2BC` | `textMuted`, `mutedForeground`, `icon` |
| primary `#3B2FD6` | `primary` + `primaryForeground` |
| accent amber `#F5A524` | `orange`/`yellow` accents |
| success/warning/danger/info `#16A34A/#F59E0B/#DC2626/#0EA5E9` | `success/warning/destructive|error/info` |

- `theme/globals.ts`: card radius **20**, control radius **14** (new `CONTROL_RADIUS`), pills **999**, `HEIGHT 48`, `SPACING {xs:4, sm:8, md:12, lg:20, xl:28}`.
- `theme/typography.ts`: Inter scale (headline-xl…label-sm, `metric-tabular` w/ tabular numerals), `fontFamilyFor(weight, lang)` → `Inter_*` / `NotoSansDevanagari_*`.
- Fonts loaded in root `_layout` (SplashScreen-gated); switch on language change.
- Vendored BNA files edited for tokens (eslint-ignored, documented): `text/button/input/card/badge`.
- Surface tiers: card = 1px hairline stroke; overlays = `0 8px 30px rgba(15,18,34,.06)` light / `rgba(0,0,0,.40)` dark; nav = blur 20px + `rgba(255,255,255,.82)` / `rgba(20,24,36,.82)`.

## 7. Navigation

Tabs (from mock `campaign_dashboard_light` footer nav): **Home · Booths · Tasks · Calendar · More**

```
app/(tabs)/
├─ _layout.tsx            animated floating tab bar (see §8)
├─ (home)/_layout.tsx     index (Dashboard) + modal quick-actions (new-task, report-issue, new-event)
├─ booths/_layout.tsx     index (list+filters), [id] (detail), voters reachable from booth
├─ tasks/_layout.tsx      index (list+filters), [id] (detail/edit), new (modal)
├─ calendar/_layout.tsx   index (agenda), [id], new (modal)
└─ more/_layout.tsx       index (hub grid)
     ├─ voters: index, [id], new(modal)
     ├─ team:   index, [id], new(modal)
     ├─ issues: index, [id], new(modal)
     ├─ expenses: index, new(modal), [id]
     ├─ compliance: index, [id]
     └─ settings/index
app/(auth)/…              unchanged (sign-in/up/reset)
app/(onboarding)/         rewritten copy + language step
```

**Teardown:** delete `(tabs)/search/` + `providers/search-context.tsx`, `app/sheet.tsx` + `components/sheet.tsx` + root `sheet` Stack.Screen, `_layout.web.tsx`, demo `useTasks` owner-scoped logic, settings tab badge.

## 8. Animated tab bar (`components/nav/`)

- `floating-tab-bar.tsx` — expo-router `Tabs` custom `tabBar`; frosted pill (expo-blur, 20px radius, 16px side insets, 12px above safe area, hairline top stroke, `0 8px 30px rgba(15,18,34,.08)` shadow).
- `tab-item.tsx` — icon-only default; active: pill fills `#3B2FD6`, white icon, label slides in (width + opacity spring), icon scale pop (reanimated spring).
- `tab-indicator.tsx` — shared `useAnimatedStyle` translateX of a background pill across items (measured layout), `withSpring` damping ≈ 18.
- 5 items, lucide icons (`LayoutGrid, MapPin? → how_to_vote≈Vote, ListChecks, CalendarDays, SlidersHorizontal`), badge support, haptics on press.
- Animation utilities centralized in `lib/animation.ts` (springs/curves reused by future animated components).

## 9. Component inventory (< 500 LOC each, separate files, reusable)

`components/campaign/` — `stat-card`, `sparkline`, `hero-card` (indigo gradient + radial ring + topographic SVG), `quick-action`, `section-header`, `progress-rail`, `donut-chart`, `chart-card`, `list-row`, `status-badge`, `empty-state`, `filter-bar`, `filter-sheet`, `search-input`, `hierarchy-picker` (Ward▸Area▸Booth chips), `date-field`, `amount-field`, `confirm-delete`, `activity-feed`, `schedule-row`, `attention-row`, `date-chip`, `stat-grid`, `avatar-fallback`, `entity-form-*` (per module).
`components/nav/` — tab bar set (§8).
`components/ui/` — BNA vendored (untouched except token edits).

## 10. Screens (data + behavior)

1. **Dashboard** (1:1 with mock): header (brandmark + Campaign Ops/Dashboard + search + avatar) · greeting (avatar + presence dot + "Campaign Day X · N days to polling" + notification/tune) · hero card (gradient `#3B2FD6→#2100BD`, grid texture SVG, radial % ring, booths covered/active workers/tasks done today) · 4 quick actions (New Task, Report Issue, Add Event, Booth In) · 2×2 metric tiles with sparklines (Pending tasks, Open issues, Events this week, Expenses) · Task completion area chart w/ 7D/30D toggle · Booth coverage by ward progress rails (low-ward highlighted) · Issues donut + legend · Needs attention list (derived: overdue tasks, booths w/o coordinator, critical issues) · Upcoming schedule (next 3 events) · Recent activity feed.
2. **Booths:** hierarchy filter chips + search + coordinator status; detail = booth info, coordinator assign, voters preview, tasks/issues for booth.
3. **Voters:** flagship filtering — cascading Ward▸Area▸Booth + gender + age band + sort + substring search (name/rollId/house), counts, add/edit/delete.
4. **Tasks:** status pills (Pending/In Progress/Completed/Issue), assignee/area filters, search, sort by due date; detail w/ status transitions + report; create modal.
5. **Issues:** category chips + status + area, photo optional (image-picker → Storage), create modal.
6. **Calendar:** month/uptime agenda from events; type filter; create modal; deadline styling.
7. **More hub:** grid → Voter Roll, Team, Issues, Expenses, Compliance, Notifications, Settings (+ language, sign out).
8. **Expenses:** date/category/status filters, ₹ totals, add w/ receipt (Storage), approve/reject toggle.
9. **Compliance:** checklist grouped by status (Done/Pending/Attention), inline toggle, due dates.
10. **Settings:** profile card (avatar upload, display name), language segmented, theme mode toggle, sign out, delete account.
11. **Auth/onboarding:** existing screens + campaign copy + language step; auth screen title/branding updated.

Every list: loading skeletons, empty states, error + retry, live `onSnapshot`, toast on mutations.

## 11. Seed (real Firestore, `scripts/seed.mjs`)

`firebase-admin` (devDep), requires `GOOGLE_APPLICATION_CREDENTIALS`; `--force` to overwrite. Seeds: 1 campaign, 1 constituency, 4 wards, 12 areas, 40 booths, ~800 voters, 16 team, 25 tasks, 18 issues, 20 events, 25 expenses, 12 compliance — neutral non-partisan names, EN labels (UI translates).

## 12. CI (`.github/workflows` → repo root, `working-directory: mobile`)

- `build-android.yml` — dispatch(dev|release), prebuild, identity guard from `constants/brand.json`, versionCode = commit count, keystore secrets w/ debug-signing fallback, APK artifacts.
- `build-android-production.yml` — **AAB, kept, dispatch-only** (`bundleRelease`).
- `build-ios.yml` — macos runner, prebuild + pods, unsigned fallback without cert secrets.
- `build-web.yml` — `expo export --platform web` (+ optional Vercel), no Next.js/monorepo leftovers.
- Stripped: `@repo/shared`, `apps/mobile` paths, `com.promptview.app`, AdMob/Admin API/Upstash secrets.

## 13. Verification gate

`npx tsc --noEmit` → `npm run lint` → `npm test` (models/filters/format/errors/auth-link/secure-store) → `npm run rules:test` (JDK 21) → `npx expo config --type public` sanity → per-screen visual check against `stich_ui/*/screen.png`.

## 14. Status

- [x] P0 Foundation: plan.md, deps, brand/app.config, theme tokens, typography, fonts
- [x] P1 i18n scaffold (en/hi + persistence + typed keys)
- [x] P2 Data layer: collections/models/filters/format/hooks/rules/indexes/seed (seed written; **content replaced once the data PDF lands** — `data/veernagar-1.pdf`)
- [x] P3 Nav shell: floating tab bar (`components/nav/*`, springs in `lib/animation.ts`), Core-7 route scaffold (booths/tasks/calendar/more + settings under more), demo teardown (search tab + context, sheet route, `_layout.web.tsx`, settings tab badge; `useTasks` owner-scoping already gone with the shared-campaign model)
- [ ] P4 Screens: dashboard → booths → tasks → calendar → more → voters/team/issues/expenses/compliance/settings → onboarding copy
- [ ] P5 i18n completeness pass + animation polish
- [x] P6 CI rewrite (4 workflows at repo root `.github/workflows`, `working-directory: mobile`, identity guard from `constants/brand.json`, dispatch-only)
- [ ] P7 Verify + README

**Done by user:** `git init` + remote `bluehawk1711/election-managment` · `google-services.json` · `service-account.json` · `mobile/.env` (six `EXPO_PUBLIC_FIREBASE_*`) + matching GitHub secrets · `.firebaserc` → `election-managment` · app identity `com.campaignos.app`.

**Dev-build readiness (verified):** `expo config` ✓, `expo prebuild --platform android` ✓ (applicationId + google-services wired, CI identity guard replicated green), web export bundles all Core-7 routes ✓. `app.config.ts` reads `constants/brand.json` — Expo's config loader resolves its imports with plain Node and cannot load a nested `.ts` file, so the identity lives in JSON (typed re-export in `constants/brand.ts` for app code).

**Still blocked on user:** first commit + push (workflows and secrets only act from the default branch) · app logo/display name · seed content from `data/veernagar-1.pdf`.
