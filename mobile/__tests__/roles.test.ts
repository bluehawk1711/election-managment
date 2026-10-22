import {
  APP_ROLES,
  can,
  canReadWard,
  roleAtLeast,
  roleLabelKey,
  toAppRole,
  visibleWards,
  type AppRole,
} from '@/lib/roles';

const ALL = [1, 2, 3];

describe('can()', () => {
  it('gives every role the roll itself', () => {
    for (const role of APP_ROLES) {
      expect(can(role, 'voterRead')).toBe(true);
      expect(can(role, 'voterEdit')).toBe(true);
    }
  });

  it('restricts report scope to admin and above', () => {
    expect(can('karykarta', 'reportAllBooths')).toBe(false);
    expect(can('admin', 'reportAllBooths')).toBe(true);
    expect(can('superAdmin', 'reportAllBooths')).toBe(true);
    expect(can('developer', 'reportAllBooths')).toBe(true);
  });

  it('restricts account creation to admin and above', () => {
    expect(can('karykarta', 'accountManage')).toBe(false);
    expect(can('admin', 'accountManage')).toBe(true);
    expect(can('superAdmin', 'accountManage')).toBe(true);
    expect(can('developer', 'accountManage')).toBe(true);
  });

  it('lets admin-and-above view the roster without managing it', () => {
    // The roster split: everything anyone creates must be visible to the
    // people below them — an admin opens Accounts and sees the team — while
    // create/role-grant stay account-managed (admin upward). Widened
    // visibility must never widen write access — the rules mirror the same
    // two helpers (canViewAccounts / canManageAccounts).
    expect(can('karykarta', 'accountView')).toBe(false);
    expect(can(null, 'accountView')).toBe(false);
    expect(can('root', 'accountView')).toBe(false);
    expect(can('admin', 'accountView')).toBe(true);
    expect(can('superAdmin', 'accountView')).toBe(true);
    expect(can('developer', 'accountView')).toBe(true);
    // Manage ⊆ view, always.
    for (const role of APP_ROLES) {
      if (can(role, 'accountManage')) expect(can(role, 'accountView')).toBe(true);
    }
  });

  it('restricts putting a phone number in use to superAdmin and developer', () => {
    // Proposing a number is `voterEdit` (every role); the CHOICE of which
    // number the team dials is a super admin's — a wrong "in use" number
    // silently misdirects every call the app makes.
    expect(can('karykarta', 'contactFinalize')).toBe(false);
    expect(can('admin', 'contactFinalize')).toBe(false);
    expect(can('superAdmin', 'contactFinalize')).toBe(true);
    expect(can('developer', 'contactFinalize')).toBe(true);
    expect(can(null, 'contactFinalize')).toBe(false);
  });

  it('restricts data tools to developer', () => {
    expect(APP_ROLES.filter((role) => can(role, 'dataTools'))).toEqual([
      'developer',
    ]);
  });

  it('denies everything to an absent or unknown role', () => {
    expect(can(null, 'voterRead')).toBe(false);
    expect(can(undefined, 'voterEdit')).toBe(false);
    expect(can('root', 'accountManage')).toBe(false);
    expect(can(42, 'voterRead')).toBe(false);
  });
});

describe('roleAtLeast()', () => {
  it('ranks karykarta < admin < superAdmin < developer', () => {
    expect(roleAtLeast('admin', 'karykarta')).toBe(true);
    expect(roleAtLeast('admin', 'admin')).toBe(true);
    expect(roleAtLeast('karykarta', 'admin')).toBe(false);
    expect(roleAtLeast('developer', 'superAdmin')).toBe(true);
    expect(roleAtLeast('superAdmin', 'developer')).toBe(false);
  });

  it('is false for junk', () => {
    expect(roleAtLeast(null, 'karykarta')).toBe(false);
    expect(roleAtLeast('sudo', 'karykarta')).toBe(false);
  });
});

describe('ward scoping', () => {
  it('leaves every non-karykarta role unrestricted', () => {
    const roles: AppRole[] = ['admin', 'superAdmin', 'developer'];
    for (const role of roles) {
      expect(visibleWards(role, { wardNo: 7 }, ALL)).toBeNull();
      expect(canReadWard(role, { wardNo: 7 }, 99)).toBe(true);
    }
  });

  it('scopes a karykarta to their assigned ward', () => {
    expect(visibleWards('karykarta', { wardNo: 2 }, ALL)).toEqual([2]);
    expect(canReadWard('karykarta', { wardNo: 2 }, 2)).toBe(true);
    expect(canReadWard('karykarta', { wardNo: 2 }, 3)).toBe(false);
  });

  it('grants a karykarta with no assignment nothing at all', () => {
    // Scope has to be granted; defaulting to "all wards" would make the
    // restriction unenforceable in practice (plan-voters.md §5).
    expect(visibleWards('karykarta', null, ALL)).toEqual([]);
    expect(visibleWards('karykarta', {}, ALL)).toEqual([]);
    expect(canReadWard('karykarta', null, 1)).toBe(false);
  });

  it('grants nothing to a user without a role', () => {
    expect(visibleWards(null, { wardNo: 1 }, ALL)).toEqual([]);
    expect(canReadWard(null, null, 1)).toBe(false);
  });
});

describe('role labels', () => {
  it('maps roles to i18n keys', () => {
    expect(roleLabelKey('karykarta')).toBe('role.karykarta');
    expect(roleLabelKey('developer')).toBe('role.developer');
    expect(roleLabelKey('nonsense')).toBe('role.none');
    expect(roleLabelKey(null)).toBe('role.none');
  });

  it('parses only known roles', () => {
    expect(toAppRole('admin')).toBe('admin');
    expect(toAppRole('root')).toBeNull();
    expect(toAppRole(null)).toBeNull();
  });
});
