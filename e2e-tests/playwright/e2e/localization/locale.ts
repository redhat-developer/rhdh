import deBackstage from "../../../../translations/backstage-de.json" with { type: "json" };
import esBackstage from "../../../../translations/backstage-es.json" with { type: "json" };
import frBackstage from "../../../../translations/backstage-fr.json" with { type: "json" };
import itBackstage from "../../../../translations/backstage-it.json" with { type: "json" };
import jaBackstage from "../../../../translations/backstage-ja.json" with { type: "json" };
import deRhdh from "../../../../translations/rhdh-de.json" with { type: "json" };
import esRhdh from "../../../../translations/rhdh-es.json" with { type: "json" };
import frRhdh from "../../../../translations/rhdh-fr.json" with { type: "json" };
import itRhdh from "../../../../translations/rhdh-it.json" with { type: "json" };
import jaRhdh from "../../../../translations/rhdh-ja.json" with { type: "json" };
import deRhdhPlugins from "../../../../translations/rhdh-plugins-de.json" with { type: "json" };
import esRhdhPlugins from "../../../../translations/rhdh-plugins-es.json" with { type: "json" };
import frRhdhPlugins from "../../../../translations/rhdh-plugins-fr.json" with { type: "json" };
import itRhdhPlugins from "../../../../translations/rhdh-plugins-it.json" with { type: "json" };
import jaRhdhPlugins from "../../../../translations/rhdh-plugins-ja.json" with { type: "json" };
import en from "../../../../translations/test/all-en.json" with { type: "json" };

const de = {
  ...deBackstage,
  ...deRhdh,
  ...deRhdhPlugins,
};

const es = {
  ...esBackstage,
  ...esRhdh,
  ...esRhdhPlugins,
};

const fr = {
  ...frBackstage,
  ...frRhdh,
  ...frRhdhPlugins,
};

const it = {
  ...itBackstage,
  ...itRhdh,
  ...itRhdhPlugins,
};

const ja = {
  ...jaBackstage,
  ...jaRhdh,
  ...jaRhdhPlugins,
};

const LOCALES = ["de", "en", "es", "fr", "it", "ja"] as const;
export type Locale = (typeof LOCALES)[number];

const NON_EN_LOCALE_BUNDLES = {
  de,
  es,
  fr,
  it,
  ja,
} as const;

const LOCALE_SET = new Set<string>(LOCALES);

function isLocale(lang: string): lang is Locale {
  return LOCALE_SET.has(lang);
}

type TranslationFile = Record<string, Record<string, Record<string, string>>>;

/**
 * Merge translations with English fallback.
 * For each namespace, if a locale doesn't have translations, fall back to English.
 */
function createMergedTranslations() {
  const allNamespaces = new Set([
    ...Object.keys(en),
    ...Object.keys(de),
    ...Object.keys(es),
    ...Object.keys(fr),
    ...Object.keys(it),
    ...Object.keys(ja),
  ]);

  const merged: Record<string, Record<string, Record<string, string>>> = {};

  for (const namespace of allNamespaces) {
    const enKeys = (en as TranslationFile)[namespace]?.en ?? {};
    const namespaceTranslations: Record<string, Record<string, string>> = {
      en: enKeys,
    };

    for (const locale of LOCALES) {
      if (locale === "en") {
        continue;
      }
      namespaceTranslations[locale] = {
        ...enKeys,
        ...(NON_EN_LOCALE_BUNDLES[locale] as TranslationFile)[namespace]?.[locale],
      };
    }

    merged[namespace] = namespaceTranslations;
  }

  return merged;
}

const translations = createMergedTranslations();

export function getCurrentLanguage(): Locale {
  const lang = process.env.LOCALE ?? "en";
  return isLocale(lang) ? lang : "en";
}

export function getTranslations() {
  return translations;
}

/**
 * Get a translation string by namespace and key.
 * Evaluates language at runtime, so works correctly regardless of when module is loaded.
 * @example tr("rhdh", "menuItem.home")
 */
export function tr(namespace: string, key: string): string {
  const lang = getCurrentLanguage();
  return translations[namespace]?.[lang]?.[key] ?? key;
}
