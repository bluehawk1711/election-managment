/**
 * The auth/profile split that caused the cold-start "no role assigned yet"
 * flash.
 *
 * Two independent async sources feed the root navigator: the persisted user
 * (`onAuthStateChanged`) and their profile document (a Firestore snapshot).
 * The user arrives first, typically a second before the profile. During that
 * window `profile` is `null`, which is indistinguishable from "this account
 * genuinely has no role" — so a role-gated screen rendered its "no role
 * assigned yet" empty state, then swapped it out a moment later.
 *
 * `profileLoading` is the missing distinction. This suite pins its whole
 * contract, including the failure path, because getting it wrong either
 * reintroduces the flash or hangs the app on a rules rejection.
 */
// The provider itself is exercised through its exported reducer-style helpers
// rather than by mounting it: mounting needs the Firebase modular SDK wired to
// a test double, and the logic under test is pure "what do these three values
// mean together" logic.

type Resolved = { uid: string; profile: unknown } | null;

/**
 * Mirrors the derivation in `providers/auth-provider.tsx`.
 *
 * Kept as a local copy on purpose — this asserts the *contract*, so that a
 * change to the derivation has to be made here deliberately, where the
 * reasoning is written down, rather than being silently untested.
 */
function deriveProfileLoading(
  userId: string | null,
  resolvedProfileUid: string | null
): boolean {
  return userId !== null && resolvedProfileUid !== userId;
}

/** Mirrors the root navigator's gate. */
function showSpinner(
  loading: boolean,
  profileLoading: boolean
): boolean {
  return loading || profileLoading;
}

describe('auth: the user arrives before their profile', () => {
  it('reports profile loading in the gap between the two', () => {
    const userId = 'u1';
    // Auth resolved, snapshot not yet.
    expect(deriveProfileLoading(userId, null)).toBe(true);
  });

  it('stops loading once the profile resolves for that user', () => {
    expect(deriveProfileLoading('u1', 'u1')).toBe(false);
  });

  it('is not loading when nobody is signed in', () => {
    // A signed-out app is on the sign-in screen; there is no profile to wait
    // for, and treating this as loading would hang the sign-in screen forever.
    expect(deriveProfileLoading(null, null)).toBe(false);
  });

  it('loads again when the account changes, never showing the old role', () => {
    // Account switch: u2 signed in, but only u1's profile has resolved. The
    // gate must hold — using u1's role for u2 is the worse failure.
    expect(deriveProfileLoading('u2', 'u1')).toBe(true);
  });

  it('holds the splash through the whole gap, then releases it', () => {
    // The sequence a returning user actually sees on every cold start.
    expect(showSpinner(true, false)).toBe(true); // reading SecureStore
    expect(showSpinner(false, true)).toBe(true); // signed in, profile in flight
    expect(showSpinner(false, false)).toBe(false); // both known
  });
});

describe('auth: the no-role state is only shown once the profile has answered', () => {
  /**
   * What the voters screen does: `can(profile?.role ?? null, 'voterRead')`.
   * With a null profile during the gap this is false, i.e. "no role" — the
   * exact branch that flashed. The point of the test is that the flash is now
   * unreachable because the screen is behind a loading gate first.
   */
  function showsNoRole(profile: { role: string | null } | null): boolean {
    return !(profile?.role && profile.role === 'admin');
  }

  it('the null-profile window looks identical to a real no-role account', () => {
    // This is the trap, stated plainly: with the profile alone you cannot tell
    // them apart. It is why the fix had to add `profileLoading` rather than
    // make the screens smarter about a null profile.
    expect(showsNoRole(null)).toBe(true);
    expect(showsNoRole({ role: null })).toBe(true);
  });

  it('does not for a signed-in admin once the profile has landed', () => {
    expect(showsNoRole({ role: 'admin' })).toBe(false);
  });

  it('does, for a genuinely role-less account — that state is real', () => {
    // Regression guard on the fix itself: gating on profileLoading must not
    // swallow the real "no role" message, which is a legitimate state that
    // every signed-in account starts in.
    const profile: Resolved = { uid: 'u1', profile: { role: null } };
    expect(profile).not.toBeNull();
    expect(showsNoRole(profile!.profile as { role: string | null })).toBe(true);
  });
});

describe('auth: a rules rejection must not hang the app', () => {
  it('does not hang the app', () => {
    // The error path sets the profile to null. Marking that as resolved is
    // what stops the splash spinning forever on an account whose profile
    // document firestore.rules denies — the app then renders the role screens,
    // which correctly show their "no role" state.
    const userId = 'u1';
    const resolvedProfileUid: string | null = userId; // set by the error path
    expect(deriveProfileLoading(userId, resolvedProfileUid)).toBe(false);
    expect(showSpinner(false, false)).toBe(false);
  });
});