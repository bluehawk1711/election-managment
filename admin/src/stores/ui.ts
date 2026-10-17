/**
 * Chrome-only UI state: the sidebar's collapsed flag.
 *
 * Persisted under a version key so tomorrow's extra toggles (density, theme,
 * …) can bump the version rather than colliding with today's shape.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UiState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  /** Mobile: the nav lives behind an overlay drawer below `md`. */
  mobileNavOpen: boolean;
  setMobileNav: (open: boolean) => void;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      mobileNavOpen: false,
      setMobileNav: (open) => set({ mobileNavOpen: open }),
    }),
    { name: 'panel-ui', version: 1 }
  )
);