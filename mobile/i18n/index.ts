import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
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

function detectDeviceLanguage(): Language {
  const code = getLocales()[0]?.languageCode?.toLowerCase();
  return code?.startsWith('hi') ? 'hi' : 'en';
}

/** Initial language: device locale, overridden by the stored choice below. */
const initialLanguage = detectDeviceLanguage();

i18next.use(initReactI18next);
i18next.init({
  resources: {
    en: { translation: en },
    hi: { translation: hi },
  },
  lng: initialLanguage,
  fallbackLng: 'en',
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
