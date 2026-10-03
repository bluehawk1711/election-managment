import {
  isLanguage,
  setLanguage as persistLanguage,
  SUPPORTED_LANGUAGES,
  type Language,
} from '@/i18n';
import { useTranslation } from 'react-i18next';

/**
 * Active language + setter backed by i18next. The preference is persisted to
 * AsyncStorage by `i18n/index.ts`, so it survives a restart.
 */
export function useLanguage(): {
  language: Language;
  languages: readonly Language[];
  setLanguage: (language: Language) => Promise<void>;
} {
  const { i18n } = useTranslation();
  const current = isLanguage(i18n.language) ? i18n.language : 'hi';

  return {
    language: current,
    languages: SUPPORTED_LANGUAGES,
    setLanguage: persistLanguage,
  };
}
