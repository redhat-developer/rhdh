import { EN } from "./en";
import { FR } from "./fr";
import { DE } from "./de";

const locales = { en: EN, fr: FR, de: DE };
export type Locale = keyof typeof locales;

export function getCurrentLanguage(): Locale {
  const lang = process.env.LOCALE || "en";
  return lang as Locale;
}

export function getLocale(lang: Locale = getCurrentLanguage()) {
  return locales[lang] || locales.en;
}

export function getTranslations() {
  const lang = getCurrentLanguage();
  return getLocale(lang);
}
