import type { ConfigContext, ExpoConfig } from 'expo/config';

import brand from './constants/brand.json';

/**
 * app.json carries the static native config; identity fields are overridden
 * from `constants/brand.json` so there is exactly one place to rename the app.
 *
 * The JSON (not `constants/brand.ts`) is loaded because Expo's config loader
 * transpiles this file but resolves its imports with plain Node, which cannot
 * require a nested .ts module.
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
