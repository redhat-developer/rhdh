import frRhdh from "../../../../translations/rhdh_v1.8_s3281-fr-C.json" with { type: "json" };
import frCorePlugins from "../../../../translations/core-plugins_v1.8_s3281-fr-C.json" with { type: "json" };
import frCommunityPlugins from "../../../../translations/community-plugins_v1.8_s3281-fr-C.json" with { type: "json" };
import frRhdhPlugins from "../../../../translations/rhdh-plugins__v1.8_s3281-fr-C.json" with { type: "json" };
import frMissingTranslations from "../../../../translations/test/missing-fr-translations.json" with { type: "json" };

import en from "../../../../translations/test/all-v1.8_s3281-en.json" with { type: "json" };

const fr = {
  ...frRhdh,
  ...frCorePlugins,
  ...frCommunityPlugins,
  ...frRhdhPlugins,
  ...frMissingTranslations,
};

const locales = { en, fr };
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
