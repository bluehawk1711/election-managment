import { hasBackHistory, type BackHistoryState } from '@/lib/back-history';

/**
 * The state shapes below are hand-written mirrors of what
 * `navigationRef.getRootState()` actually returns for this app's tree:
 * root Stack (auth/onboarding/tabs guarded) → Tabs → per-tab Stack.
 *
 * The stakes: a `false` here that should be `true` is the reported bug —
 * the hardware back button exiting the app on a screen that has somewhere to
 * go back to. A `true` that should be `false` would swallow the exit at the
 * app's root. Both directions are pinned.
 */
describe('hasBackHistory', () => {
  const leafStack = (depth: number): BackHistoryState => ({
    type: 'stack',
    index: depth - 1,
    routes: Array.from({ length: depth }, (_, i) => ({ name: `screen${i}` })),
  });

  const tabState = (
    focusedIndex: number,
    history: string[],
    leaf: BackHistoryState
  ): BackHistoryState => ({
    type: 'tab',
    index: focusedIndex,
    history: history.map((key) => ({ key })),
    // The walked chain always ends at `routes[index]`, so the nested stack
    // under test has to sit on the *focused* route — the others stay flat,
    // the way an untouched tab does.
    routes: ['home', 'voters', 'booths', 'reports', 'more'].map((name, i) => ({
      name,
      state: i === focusedIndex ? leaf : leafStack(1),
    })),
  });

  const root = (tab: BackHistoryState): BackHistoryState => ({
    type: 'stack',
    index: 0,
    routes: [{ name: '(tabs)', state: tab }],
  });

  it('declines at the app root — back may exit the OS app there', () => {
    // Voters tab, its stack one screen deep, no tab history behind it: the
    // landing state after sign-in. Nothing to pop.
    expect(hasBackHistory(root(tabState(1, ['voters'], leafStack(1))))).toBe(
      false
    );
  });

  it('declines on a missing or empty state', () => {
    expect(hasBackHistory(null)).toBe(false);
    expect(hasBackHistory(undefined)).toBe(false);
    expect(hasBackHistory({ type: 'stack', index: 0, routes: [] })).toBe(false);
  });

  it('accepts a pushed modal inside a tab stack — the reported bug', () => {
    // voters/index → voters/edit. The tab index is > 0 *and* the nested stack
    // is two deep; canGoBack() has been observed declining on exactly this.
    expect(hasBackHistory(root(tabState(1, ['voters'], leafStack(2))))).toBe(
      true
    );
  });

  it('accepts depth in a stack even when the tab itself is index 0', () => {
    expect(hasBackHistory(root(tabState(0, ['home'], leafStack(3))))).toBe(
      true
    );
  });

  it('accepts tab history — a previous tab visit is go-back-able', () => {
    expect(
      hasBackHistory(root(tabState(4, ['voters', 'more'], leafStack(1))))
    ).toBe(true);
  });

  it('ignores a tab index with a single-entry history', () => {
    // Focus is on the last-declared tab but it was the launch route: no
    // history item to go back to, so the press must keep falling through.
    expect(hasBackHistory(root(tabState(4, ['more'], leafStack(1))))).toBe(
      false
    );
  });

  it('finds depth below a root stack holding more than one route', () => {
    const state: BackHistoryState = {
      type: 'stack',
      index: 1,
      routes: [
        { name: '(auth)' },
        { name: '(tabs)', state: root(tabState(1, ['voters'], leafStack(2))) },
      ],
    };
    expect(hasBackHistory(state)).toBe(true);
  });

  it('treats a state with no index as focused on its last route', () => {
    const partial: BackHistoryState = {
      routes: [{ name: 'voters', state: leafStack(2) }],
    };
    expect(hasBackHistory(partial)).toBe(true);
  });
});