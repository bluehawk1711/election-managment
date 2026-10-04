import type { ConfigContext, ExpoConfig } from 'expo/config';

import brand from './constants/brand.json';

/**
 * app.json carries the static native config; identity fields are overridden
 * from `constants/brand.json` so there is exactly one place to rename the app.
 *
 * The JSON (not `constants/brand.ts`) is loaded because Expo's config loader
 * transpiles this file but resolves its imports with plain Node, which cannot
 * require a nested .ts module.
 *
 * ── Asset variants: DERIVED from logo.png ──────────────────────────────
 *
 * `assets/images/logo.png` (1049×1008) stays the single source; the three
 * fields it cannot serve directly are generated from it by
 * `scripts/generate-brand-assets.mjs` (`pnpm brand:assets`), so `app.json`
 * points at:
 *
 *   1. `icon` → `icon-1024.png` — a square 1024×1024 with the logo contained
 *      and centred. The source's 1049×1008 is rejected by Expo's config
 *      schema ("image should be square"), which is what `npx expo-doctor`
 *      reported as a failing check.
 *   2. `adaptiveIcon.foregroundImage` → `adaptive-foreground-1024.png` — the
 *      mark inside Android's 66%-safe-zone circle on a TRANSPARENT background.
 *      A full-bleed opaque logo gets masked down to whatever survives the
 *      mask, so the mark ends up small and can be clipped by a circular or
 *      squircle mask.
 *   3. `adaptiveIcon.monochromeImage` → `adaptive-monochrome-1024.png` —
 *      white-on-transparent for Android 13+ themed icons, which tint it with
 *      the user's wallpaper palette. Pointing it at a purple logo means the
 *      themed icon is either ignored or renders as a purple blob.
 *
 * `web.favicon` and the splash image still point straight at `logo.png`: both
 * are allowed to be non-square, and neither is what expo-doctor checks.
 *
 * A notification icon (white silhouette, transparent background) is also
 * missing, which is why there is no `expo-notifications` entry anywhere.
 *
 * Regenerating after a logo change is one command (`pnpm brand:assets`), and
 * the script is pure JS on `pngjs` — no native build step to break.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  name: brand.name,
  slug: brand.slug,
  scheme: brand.scheme,
  ios: {
    ...config.ios,
    bundleIdentifier: brand.bundleIdentifier,
  },
  android: {
    ...config.android,
    package: brand.packageName,
  },
});
