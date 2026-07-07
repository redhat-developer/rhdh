import { readFileSync } from "node:fs";
import { join } from "node:path";

type TranslationFile = Record<string, Record<string, Record<string, string>>>;

const TRANSLATIONS_DIR = join(import.meta.dirname, "../../../../translations");

function loadTranslationJson(fileName: string): TranslationFile {
  const raw: unknown = JSON.parse(readFileSync(join(TRANSLATIONS_DIR, fileName), "utf8"));
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`Invalid translation file: ${fileName}`);
  }
  // Translation bundles are trusted repo fixtures; validate only top-level shape.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON fixture files are repo-controlled
  return raw as TranslationFile;
}

const deBackstage = loadTranslationJson("backstage-de.json");
const esBackstage = loadTranslationJson("backstage-es.json");
const frBackstage = loadTranslationJson("backstage-fr.json");
const itBackstage = loadTranslationJson("backstage-it.json");
const jaBackstage = loadTranslationJson("backstage-ja.json");
const deRhdh = loadTranslationJson("rhdh-de.json");
const esRhdh = loadTranslationJson("rhdh-es.json");
const frRhdh = loadTranslationJson("rhdh-fr.json");
const itRhdh = loadTranslationJson("rhdh-it.json");
const jaRhdh = loadTranslationJson("rhdh-ja.json");
const deRhdhPlugins = loadTranslationJson("rhdh-plugins-de.json");
const esRhdhPlugins = loadTranslationJson("rhdh-plugins-es.json");
const frRhdhPlugins = loadTranslationJson("rhdh-plugins-fr.json");
const itRhdhPlugins = loadTranslationJson("rhdh-plugins-it.json");
const jaRhdhPlugins = loadTranslationJson("rhdh-plugins-ja.json");
const en = loadTranslationJson("test/all-en.json");

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
    const enKeys = en[namespace]?.en ?? {};
    const namespaceTranslations: Record<string, Record<string, string>> = {
      en: enKeys,
    };

    for (const locale of LOCALES) {
      if (locale === "en") {
        continue;
      }
      namespaceTranslations[locale] = {
        ...enKeys,
        ...NON_EN_LOCALE_BUNDLES[locale][namespace]?.[locale],
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

/** Resolve app locale from Playwright project locale or process env. */
export function resolveLocale(localeHint?: string): Locale {
  const lang = localeHint ?? process.env.LOCALE ?? "en";
  return isLocale(lang) ? lang : "en";
}

export function getTranslations() {
  return translations;
}
