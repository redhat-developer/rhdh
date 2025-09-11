import { TranslationConfig } from '../../types/types';

/**
 * Determines the default language:
 */
export const getDefaultLanguage = (
  translationConfig?: TranslationConfig,
): string => {
  // Priority 1: try to use browser language if supported
  const availableLocales = translationConfig?.locales ?? ['en'];
  const browserLanguages = navigator.languages || [navigator.language];

  // Find the first browser language that's supported
  for (const browserLang of browserLanguages) {
    if (!browserLang || typeof browserLang !== 'string') {
      continue;
    }

    if (availableLocales.includes(browserLang)) {
      return browserLang;
    }

    // Also check language codes without region (e.g., 'en' from 'en-US')
    const baseLang = browserLang.split('-')[0];
    if (baseLang && availableLocales.includes(baseLang)) {
      return baseLang;
    }
  }

  // If navigator.languages is empty or doesn't contain supported languages,
  // also check navigator.language as a fallback
  if (navigator.language && typeof navigator.language === 'string') {
    if (availableLocales.includes(navigator.language)) {
      return navigator.language;
    }

    // Check base language from navigator.language
    const baseLang = navigator.language.split('-')[0];
    if (baseLang && availableLocales.includes(baseLang)) {
      return baseLang;
    }
  }

  // Priority 2: admin configured default locale (fallback)
  if (translationConfig?.defaultLocale) {
    return translationConfig.defaultLocale;
  }

  return 'en';
};
