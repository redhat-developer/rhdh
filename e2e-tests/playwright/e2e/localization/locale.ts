import deBackstage from "../../../../translations/backstage-de.json" with { type: "json" };
import deCommunityPluginsBase from "../../../../translations/community-plugins-de.json" with { type: "json" };
import deRhdh from "../../../../translations/test/rhdh-de.json" with { type: "json" };
import deCommunityPlugins from "../../../../translations/test/community-plugins-de.json" with { type: "json" };
import deRhdhPlugins from "../../../../translations/test/rhdh-plugins-de.json" with { type: "json" };

import esBackstage from "../../../../translations/backstage-es.json" with { type: "json" };
import esCommunityPluginsBase from "../../../../translations/community-plugins-es.json" with { type: "json" };
import esRhdh from "../../../../translations/test/rhdh-es.json" with { type: "json" };
import esCommunityPlugins from "../../../../translations/test/community-plugins-es.json" with { type: "json" };
import esRhdhPlugins from "../../../../translations/test/rhdh-plugins-es.json" with { type: "json" };

import frBackstage from "../../../../translations/backstage-fr.json" with { type: "json" };
import frCommunityPluginsBase from "../../../../translations/community-plugins-fr.json" with { type: "json" };
import frRhdh from "../../../../translations/test/rhdh-fr.json" with { type: "json" };
import frCommunityPlugins from "../../../../translations/test/community-plugins-fr.json" with { type: "json" };
import frRhdhPlugins from "../../../../translations/test/rhdh-plugins-fr.json" with { type: "json" };

import itBackstage from "../../../../translations/backstage-it.json" with { type: "json" };
import itCommunityPluginsBase from "../../../../translations/community-plugins-it.json" with { type: "json" };
import itRhdh from "../../../../translations/test/rhdh-it.json" with { type: "json" };
import itCommunityPlugins from "../../../../translations/test/community-plugins-it.json" with { type: "json" };
import itRhdhPlugins from "../../../../translations/test/rhdh-plugins-it.json" with { type: "json" };

import jaBackstage from "../../../../translations/backstage-ja.json" with { type: "json" };
import jaCommunityPluginsBase from "../../../../translations/community-plugins-ja.json" with { type: "json" };
import jaRhdh from "../../../../translations/test/rhdh-ja.json" with { type: "json" };
import jaCommunityPlugins from "../../../../translations/test/community-plugins-ja.json" with { type: "json" };
import jaRhdhPlugins from "../../../../translations/test/rhdh-plugins-ja.json" with { type: "json" };

import en from "../../../../translations/test/all-v1.8_s3281-en.json" with { type: "json" };

const de = {
  ...deBackstage,
  ...deCommunityPluginsBase,
  ...deRhdh,
  ...deCommunityPlugins,
  ...deRhdhPlugins,
};

const es = {
  ...esBackstage,
  ...esCommunityPluginsBase,
  ...esRhdh,
  ...esCommunityPlugins,
  ...esRhdhPlugins,
};

const fr = {
  ...frBackstage,
  ...frCommunityPluginsBase,
  ...frRhdh,
  ...frCommunityPlugins,
  ...frRhdhPlugins,
};

const it = {
  ...itBackstage,
  ...itCommunityPluginsBase,
  ...itRhdh,
  ...itCommunityPlugins,
  ...itRhdhPlugins,
};

const ja = {
  ...jaBackstage,
  ...jaCommunityPluginsBase,
  ...jaRhdh,
  ...jaCommunityPlugins,
  ...jaRhdhPlugins,
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
 * @example tr("plugin.extensions", "common.readMore")
 */
export function tr(namespace: string, key: string): string {
  const lang = getCurrentLanguage();
  return translations[namespace]?.[lang]?.[key] ?? key;
}
