/**
 * Role model and permission checks — the panel's port of `mobile/lib/roles.ts`.
 *
 * The capability matrix is IDENTICAL to the mobile app's: the panel is one
 * more client of the same `firestore.rules`, and a divergence here would show
 * up as a button that exists but fails every press with PERMISSION_DENIED.
 * If `mobile/lib/roles.ts` changes, this file must change with it.
 *
 * Still pure and synchronous — and still not a security boundary: the rules
 * re-check `get(/users/$(uid))` for every write. This file only decides which
 * controls to render.
 */

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
 * What a role may do — mirrored from `mobile/lib/roles.ts`, comment block for
 * comment block on the two splits that matter:
 *
 * `accountView` vs `accountManage` — admins see the roster; only super admins
 * and developers create accounts and grant roles.
 *
 * `contactFinalize` — every role may PROPOSE a voter's phone number, but the
 * choice of the number the team dials from then on is a super admin's: a wrong
 * final number silently misdirects every call the product makes.
 */
const CAPABILITIES = {
  voterRead: ['karykarta', 'admin', 'superAdmin', 'developer'],
  voterEdit: ['karykarta', 'admin', 'superAdmin', 'developer'],
  reportAllBooths: ['admin', 'superAdmin', 'developer'],
  accountView: ['admin', 'superAdmin', 'developer'],
  accountManage: ['superAdmin', 'developer'],
  contactFinalize: ['superAdmin', 'developer'],
  dataTools: ['developer'],
} as const satisfies Record<string, readonly AppRole[]>;

export type Capability = keyof typeof CAPABILITIES;

export type Scope = { wardNo?: number | null } | null | undefined;

/** `true` when `role` holds `capability`. Unknown/absent roles hold nothing. */
export function can(role: unknown, capability: Capability): boolean {
  if (typeof role !== 'string') return false;
  return (CAPABILITIES[capability] as readonly string[]).includes(role);
}

/** `true` when `role` is at least as privileged as `minimum`. */
export function roleAtLeast(role: unknown, minimum: AppRole): boolean {
  if (typeof role !== 'string') return false;
  const rank = RANK[role as AppRole];
  return rank !== undefined && rank >= RANK[minimum];
}

/**
 * Which wards a role may read. `null` means unrestricted; a karykarta with no
 * ward assigned sees NOTHING — scope must be granted, not defaulted.
 */
export function visibleWards(
  role: unknown,
  scope: Scope,
  allWards: readonly number[]
): number[] | null {
  if (!can(role, 'voterRead')) return [];
  if (role === 'karykarta') {
    const wardNo = scope?.wardNo;
    return wardNo == null ? [] : allWards.filter((n) => n === wardNo);
  }
  return null;
}

/** Parses an untrusted value (a Firestore field) into a role, or `null`. */
export function toAppRole(value: unknown): AppRole | null {
  return typeof value === 'string' && (APP_ROLES as readonly string[]).includes(value)
    ? (value as AppRole)
    : null;
}

/** Display label for a role — the panel is English-only, so no i18n key. */
export function roleLabel(role: unknown): string {
  const labels: Record<AppRole, string> = {
    karykarta: 'Karykarta',
    admin: 'Admin',
    superAdmin: 'Super Admin',
    developer: 'Developer',
  };
  const parsed = toAppRole(role);
  return parsed ? labels[parsed] : 'No role';
}