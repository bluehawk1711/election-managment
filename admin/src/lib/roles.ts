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
  /**
   * Grant or change a role and its ward scope (the "Change role & ward"
   * dialog). Deliberately separate from `accountManage`: `database.rules`
   * opens exactly these three roles the `role`/`wardNo`/`wardNos` profile
   * children (never self-granted), and the claims route accepts the same
   * three — so an admin can hand a karykarta wards, while vault access,
   * locking, creating and deleting accounts stay super-admin-only on this
   * panel. Mobile keeps `admin` inside its `accountManage`; this narrower
   * capability exists so the panel can mirror the RULES' split rather than
   * pick one side of it.
   */
  roleGrant: ['admin', 'superAdmin', 'developer'],
  contactFinalize: ['superAdmin', 'developer'],
  dataTools: ['developer'],
} as const satisfies Record<string, readonly AppRole[]>;

export type Capability = keyof typeof CAPABILITIES;

export type Scope = {
  wardNo?: number | null;
  /**
   * The full assigned set (`users/{uid}.wardNos`, a sorted ward list).
   * `wardNo` remains the FIRST ward for legacy profiles and single-ward
   * readers, so consumers should pass both and let `visibleWards` union them.
   */
  wardNos?: readonly number[] | null;
} | null | undefined;

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
    // The assigned set is the UNION of both fields: a multi-ward profile
    // carries `wardNos`, a legacy or mid-refresh profile only `wardNo`.
    // Union, then filter to real wards — a karykarta with nothing assigned
    // still sees NOTHING, the same "scope must be granted" invariant.
    const assigned = new Set<number>();
    if (scope?.wardNo != null) assigned.add(scope.wardNo);
    for (const wardNo of scope?.wardNos ?? []) assigned.add(wardNo);
    return allWards.filter((n) => assigned.has(n));
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

/**
 * Panel routes a role may open. `null` means no panel-level restriction — the
 * nav's own capability filter still decides what is visible.
 *
 * The console is deliberately NARROWER than the capability matrix for a plain
 * `admin`: that role is the field-data operator, so it gets the voter roll
 * (print + bulk phone) and nothing else. Accounts, the voter-change audit,
 * tasks, overview and settings belong to the roles that own those surfaces.
 *
 * This is a UI/route guard, not a security boundary. RTDB rules still decide
 * what the signed-in token can read or write; this only keeps a screen the
 * product has scoped away from ever mounting in the console.
 */
export function panelRoutes(role: unknown): readonly string[] | null {
  return role === 'admin' ? ['/voters'] : null;
}

/** Whether `pathname` is inside one of the role's allowed panel routes. */
export function canOpenPanelRoute(role: unknown, pathname: string): boolean {
  const routes = panelRoutes(role);
  if (!routes) return true;
  return routes.some(
    (href) => pathname === href || pathname.startsWith(`${href}/`)
  );
}

/** Where a signed-in role lands, and where a blocked route sends it. */
export function panelHome(role: unknown): string {
  return role === 'admin' ? '/voters' : '/';
}
