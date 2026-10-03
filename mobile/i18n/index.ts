import AsyncStorage from '@react-native-async-storage/async-storage';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import { en } from './locales/en';
import { hi } from './locales/hi';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof en };
    returnNull: false;
  }
}

export const LANGUAGE_KEY = 'app.language';
export const SUPPORTED_LANGUAGES = ['en', 'hi'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export function isLanguage(value: unknown): value is Language {
  return (
    typeof value === 'string' &&
    (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
  );
}

/**
 * Hindi first. The stored choice (below) always wins; this is only what a
 * fresh install gets — the roll, the reports and every fieldworker-facing
 * string are written Hindi-first, so a device in English still opens the app
 * in Hindi until the user picks otherwise in Settings.
 */
const initialLanguage: Language = 'hi';

i18next.use(initReactI18next);
i18next.init({
  resources: {
    en: { translation: en },
    hi: { translation: hi },
  },
  lng: initialLanguage,
  fallbackLng: 'hi',
  interpolation: { escapeValue: false },
  returnNull: false,
});

// Hydrate the persisted preference. Best-effort: static web export and tests
// have no storage, and starting on the device locale is a fine fallback.
try {
  AsyncStorage.getItem(LANGUAGE_KEY)
    .then((stored) => {
      if (isLanguage(stored) && stored !== i18next.language) {
        return i18next.changeLanguage(stored);
      }
      return null;
    })
    .catch(() => {});
} catch {
  // Storage unavailable (e.g. static rendering) — keep the detected locale.
}

export async function setLanguage(language: Language): Promise<void> {
  try {
    await AsyncStorage.setItem(LANGUAGE_KEY, language);
  } catch {
    // Preference still applies for this session.
  }
  await i18next.changeLanguage(language);
}

export default i18next;
