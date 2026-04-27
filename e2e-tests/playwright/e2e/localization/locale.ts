import deBackstage from "../../../../translations/backstage-de.json" with { type: "json" };
import deRhdh from "../../../../translations/rhdh-de.json" with { type: "json" };

import esBackstage from "../../../../translations/backstage-es.json" with { type: "json" };
import esRhdh from "../../../../translations/rhdh-es.json" with { type: "json" };

import frBackstage from "../../../../translations/backstage-fr.json" with { type: "json" };
import frRhdh from "../../../../translations/rhdh-fr.json" with { type: "json" };

import itBackstage from "../../../../translations/backstage-it.json" with { type: "json" };
import itRhdh from "../../../../translations/rhdh-it.json" with { type: "json" };

import jaBackstage from "../../../../translations/backstage-ja.json" with { type: "json" };
import jaRhdh from "../../../../translations/rhdh-ja.json" with { type: "json" };

import en from "../../../../translations/test/all-en.json" with { type: "json" };

const de = {
  ...deBackstage,
  ...deRhdh,
};

const es = {
  ...esBackstage,
  ...esRhdh,
};

const fr = {
  ...frBackstage,
  ...frRhdh,
};

const it = {
  ...itBackstage,
  ...itRhdh,
};

const ja = {
  ...jaBackstage,
  ...jaRhdh,
};

export type Locale = "de" | "en" | "es" | "fr" | "it" | "ja";

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
    const enKeys = (en as TranslationFile)[namespace]?.en || {};
    merged[namespace] = {
      en: enKeys,
      de: { ...enKeys, ...((de as TranslationFile)[namespace]?.de || {}) },
      es: { ...enKeys, ...((es as TranslationFile)[namespace]?.es || {}) },
      fr: { ...enKeys, ...((fr as TranslationFile)[namespace]?.fr || {}) },
      it: { ...enKeys, ...((it as TranslationFile)[namespace]?.it || {}) },
      ja: { ...enKeys, ...((ja as TranslationFile)[namespace]?.ja || {}) },
    };
  }

  return merged;
}

const translations = createMergedTranslations();

export function getCurrentLanguage(): Locale {
  const lang = process.env.LOCALE || "en";
  return lang as Locale;
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
