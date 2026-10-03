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
 * ── Asset variants: NOT YET DERIVED ──────────────────────────────────────
 *
 * `app.json` points `icon`, `android.adaptiveIcon.foregroundImage`,
 * `android.adaptiveIcon.monochromeImage`, `web.favicon` and the splash image
 * all at the single source `assets/images/logo.png`. That is one file with one
 * job, and it is deliberate — but it is not what those five fields each
 * actually want, and three of them are visibly wrong on a real device:
 *
 *   1. `adaptiveIcon.foregroundImage` needs the mark inside Android's
 *      66%-safe-zone circle on a TRANSPARENT background. A full-bleed opaque
 *      logo gets masked down to whatever survives the mask, so the mark ends up
 *      small and can be clipped by a circular or squircle mask.
 *   2. `adaptiveIcon.monochromeImage` must be white-on-transparent — Android 13+
 *      tints it with the user's wallpaper palette. Pointing it at a purple logo
 *      means the themed icon is either ignored or renders as a purple blob.
 *   3. `icon` wants a square 1024×1024. `logo.png` is 1049×1008, so it is
 *      letterboxed and the mark is slightly off-centre.
 *
 * A notification icon (white silhouette, transparent background) is also
 * missing, which is why there is no `expo-notifications` entry anywhere.
 *
 * Fixing this means generating variants, not hand-tuning `app.json`, and that
 * needs image tooling this project does not have yet — `sharp` as a dev
 * dependency plus a committed `scripts/generate-brand-assets.mjs`, so
 * regenerating after a logo change is one command rather than an archaeology
 * exercise. Until that exists, the single-file approach is the best available:
 * it is consistently the right brand, everywhere, just not yet at the right
 * size or transparency per platform.
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
