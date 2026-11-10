/**
 * Strings owned by rhdh-plugins. They are built into the plugins instead of being
 * served from translations/, so only the keys the localization specs assert are
 * listed here. Copied from the rhdh-plugins commits that
 * rhdh-plugin-export-overlays builds for release-2.1:
 * - plugin.app-react, plugin.app-auth.sign-in: workspaces/app-defaults (704076c0)
 * - plugin.homepage: workspaces/homepage (e13aff21)
 * - plugin.global-header: workspaces/global-header (a19a81d4)
 * English for plugin.homepage and plugin.global-header comes from
 * translations/test/all-en.json. A locale without an entry falls back to English,
 * like the app does.
 */
export const RHDH_PLUGINS_TRANSLATIONS: Record<string, Record<string, Record<string, string>>> = {
  "plugin.app-react": {
    en: {
      "pages.Catalog": "Catalog",
      "pages.APIs": "APIs",
      "pages.Docs": "Docs",
      "pages.Learning Paths": "Learning Paths",
      // RHDH titles the scaffolder page "Self-service"; app-react only translates "Create".
      "pages.Self-service": "Self-service",
    },
    de: {
      "pages.Catalog": "Katalog",
      "pages.APIs": "APIs",
      "pages.Docs": "Dokumentation",
      "pages.Learning Paths": "Lernpfade",
    },
    es: {
      "pages.Catalog": "Catálogo",
      "pages.APIs": "APIs",
      "pages.Docs": "Documentación",
      "pages.Learning Paths": "Rutas de aprendizaje",
    },
    fr: {
      "pages.Catalog": "Catalogue",
      "pages.APIs": "APIs",
      "pages.Docs": "Documentation",
      "pages.Learning Paths": "Parcours d'apprentissage",
    },
    it: {
      "pages.Catalog": "Catalogo",
      "pages.APIs": "API",
      "pages.Docs": "Documentazione",
      "pages.Learning Paths": "Learning Path",
    },
    ja: {
      "pages.Catalog": "カタログ",
      "pages.APIs": "API",
      "pages.Docs": "ドキュメント",
      "pages.Learning Paths": "ラーニングパス",
    },
  },
  "plugin.app-auth.sign-in": {
    // No translations exist yet; the sign-in page is English in every locale.
    en: {
      "signIn.page.title": "Select a sign-in method",
    },
  },
  "plugin.homepage": {
    de: { "header.welcome": "Willkommen zurück!" },
    es: { "header.welcome": "¡Bienvenido de vuelta!" },
    fr: { "header.welcome": "Content de vous revoir!" },
    it: { "header.welcome": "Bentornato/a!" },
    ja: { "header.welcome": "おかえりなさい!" },
  },
  "plugin.global-header": {
    de: { "profile.settings": "Einstellungen" },
    es: { "profile.settings": "Configuración" },
    fr: { "profile.settings": "Paramètres" },
    it: { "profile.settings": "Impostazioni" },
    ja: { "profile.settings": "設定" },
  },
};
