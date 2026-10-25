/**
 * Role model and permission checks (plan-voters.md §5).
 *
 * Pure and synchronous on purpose: guards call this during render, and neither
 * should need a Firebase round-trip.
 *
 * Two things this file deliberately does NOT do:
 * - it never decides anything server-side — `database.rules.json` re-checks
 *   every capability against the caller's custom CLAIM, this is UX only;
 * - it never treats a missing role as a role. A user whose `users/{uid}`
 *   node has no `role` yet has no capabilities, so a freshly created
 *   account starts inert rather than privileged.
 */
import type { TranslationKey } from '@/i18n/locales/en';

export const APP_ROLES = ['karykarta', 'admin', 'superAdmin', 'developer'] as const;
export type AppRole = (typeof APP_ROLES)[number];

/** Rank for "at least this role" checks. Higher can do everything lower can. */
const RANK: Record<AppRole, number> = {
  karykarta: 0,
  admin: 1,
  superAdmin: 2,
  developer: 3,
};

/**
 * What a role may do. Kept as an explicit map rather than rank comparisons
 * everywhere so the matrix in plan-voters.md §5 has exactly one home.
 *
 * `developer` is a superset of `superAdmin` for reads. Account creation sits
 * with `accountManage`, which `admin`, `superAdmin` and `developer` all hold.
 *
 * `accountView` vs `accountManage` is the roster split: everything anyone
 * creates has to be *visible* to the people below them — an admin opens
 * Accounts and sees who is on the team — while creating accounts and granting
 * roles stays with `accountManage`. View and manage are separate capabilities
 * on purpose, so widening visibility cannot accidentally widen write access;
 * the same split exists in `database.rules.json` (the R2/R3 predicates in its
 * header).
 *
 * `admin` is included in `accountManage` so an admin can create a team member
 * account from Settings → Team accounts and More → Accounts → Create account.
 */
const CAPABILITIES = {
  voterRead: ['karykarta', 'admin', 'superAdmin', 'developer'],
  voterEdit: ['karykarta', 'admin', 'superAdmin', 'developer'],
  reportAllBooths: ['admin', 'superAdmin', 'developer'],
  /** Read the accounts roster (read-only). */
  accountView: ['admin', 'superAdmin', 'developer'],
  /** Create accounts and grant or change roles. */
  accountManage: ['admin', 'superAdmin', 'developer'],
  /**
   * Choose which team-proposed phone number is *the* number for a voter
   * (`voterPhones/{id}.finalPhone`). Proposing a number is `voterEdit` —
   * every role does that — but the choice of which one the team dials is a
   * super admin's, because a wrong "final" number silently misdirects every
   * call, WhatsApp and message the app makes from then on.
   */
  contactFinalize: ['superAdmin', 'developer'],
  dataTools: ['developer'],
} as const satisfies Record<string, readonly AppRole[]>;

export type Capability = keyof typeof CAPABILITIES;

export type Scope = {
  wardNo?: number | null;
  /**
   * The karykarta's FULL assigned ward set (`users/{uid}.wardNos`, parsed by
   * `lib/documents.ts` with a fallback to the single `wardNo`). Pass both;
   * `visibleWards` unions them so a legacy or mid-refresh profile still
   * resolves its one ward.
   */
  wardNos?: readonly number[] | null;
} | null | undefined;

/** `true` when `role` holds `capability`. Unknown/absent roles hold nothing. */
export function can(role: unknown, capability: Capability): role is AppRole {
  if (typeof role !== 'string') return false;
  return (CAPABILITIES[capability] as readonly string[]).includes(role);
}

/** `true` when `role` is at least as privileged as `minimum`. */
export function roleAtLeast(role: unknown, minimum: AppRole): role is AppRole {
  if (typeof role !== 'string') return false;
  const rank = RANK[role as AppRole];
  return rank !== undefined && rank >= RANK[minimum];
}

/**
 * Which wards a role may read.
 *
 * A karykarta is scoped to the SET `scope.wardNos` carries — falling back to
 * the single `scope.wardNo` for a legacy profile; every other role sees the
 * whole roll. `null` means "all wards".
 *
 * A karykarta with no ward assigned sees *nothing* rather than everything —
 * scope has to be granted, not defaulted, or the restriction in §5 would be
 * unenforceable in practice.
 */
export function visibleWards(
  role: unknown,
  scope: Scope,
  allWards: readonly number[]
): number[] | null {
  if (!can(role, 'voterRead')) return [];
  if (role === 'karykarta') {
    // Union of both fields — see Scope. Filtered to real ward numbers, so a
    // karykarta with nothing assigned still sees NOTHING: scope has to be
    // granted, never defaulted.
    const assigned = new Set<number>();
    if (scope?.wardNo != null) assigned.add(scope.wardNo);
    for (const wardNo of scope?.wardNos ?? []) assigned.add(wardNo);
    return allWards.filter((n) => assigned.has(n));
  }
  return null; // null = unrestricted
}

/** `true` when this role may read voters of `wardNo`. */
export function canReadWard(role: unknown, scope: Scope, wardNo: number): boolean {
  const visible = visibleWards(role, scope, [wardNo]);
  if (visible === null) return true;
  return visible.includes(wardNo);
}

/**
 * The i18n key for a role label.
 *
 * Typed as the key union rather than `string` so a screen cannot call
 * `t(roleLabelKey(role))` and get away with it — `useTranslation`'s `t` only
 * accepts known keys, which turns a renamed or deleted role into a compile
 * error instead of a key that renders as the literal text `role.karykarta`.
 *
 * The cast is unavoidable and safe: the template builds `role.${role}` only
 * after checking membership in `APP_ROLES`, and all four plus `role.none` exist
 * in both locales. `__tests__/i18n-parity.test.ts` keeps the two locales equal.
 */
export function roleLabelKey(role: unknown): TranslationKey {
  return (typeof role === 'string' && (APP_ROLES as readonly string[]).includes(role)
    ? `role.${role}`
    : 'role.none') as TranslationKey;
}

/** Parses an untrusted value (a Firestore field) into a role, or `null`. */
export function toAppRole(value: unknown): AppRole | null {
  return typeof value === 'string' && (APP_ROLES as readonly string[]).includes(value)
    ? (value as AppRole)
    : null;
}
