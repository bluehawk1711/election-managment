import brand from './brand.json';

/**
 * Single global source of truth for app identity — `constants/brand.json`.
 *
 * This module is the typed doorway to it: `app.config.ts` imports the JSON
 * directly (it cannot import this .ts file — Expo's config loader resolves
 * its own imports with plain Node), while app code imports `BRAND` from here
 * for headers, About, share sheet and the CI identity guard.
 *
 * Change a value in brand.json and it propagates everywhere — no need to hunt
 * through app.json, app.config.ts, package.json or CI.
 */
export const BRAND = brand;

export type Brand = typeof BRAND;
