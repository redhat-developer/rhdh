# Internationalization (i18n) in E2E Tests

Our Playwright-based E2E testing framework supports internationalization (i18n) to ensure tests are language-agnostic and easily adaptable across locales. Instead of hardcoding UI text in tests, we use language-specific translation variables, improving maintainability and scalability.

---

## Project Structure (Relevant to i18n)

```
e2e-tests/
├── playwright/
│   ├── e2e/
│   │   └── techdocs.spec.ts          # Example test file using i18n
│   ├── support/
│   │   └── translations/
│   │       └── techdocs/
│   │           ├── en.ts             # English translations
│   │           ├── fr.ts             # French translations
│   │           ├── de.ts             # German translations
│   │           └── index.ts          # Translation loader
```

---

## Translation Files

Each language file exports a structured dictionary of strings grouped by UI sections for clarity.

### Example: `en.ts`

```ts
export const en = {
  sidebar: {
    favorites: "Favorites",
    docs: "Docs",
  },
  techdocs: {
    linkName: "Red Hat Developer Hub",
    pageTitle: "Getting Started running RHDH",
  },
};
```

### Example: `fr.ts`

```ts
export const fr = {
  sidebar: {
    favorites: "Favoris",
    docs: "Docs",
  },
  techdocs: {
    linkName: "Red Hat Developer Hub",
    pageTitle: "Commencer avec RHDH",
  },
};
```

### Example: `de.ts`

```ts
export const de = {
  sidebar: {
    favorites: "Favoriten",
    docs: "Dokumentation",
  },
  techdocs: {
    linkName: "Red Hat Developer Hub",
    pageTitle: "Erste Schritte mit RHDH",
  },
};
```

---

## Translation Loader (`index.ts`)

```ts
import { en } from './en';
import { fr } from './fr';
import { de } from './de';

export const locales = { en, fr, de };

export type Locale = keyof typeof locales;

export const getCurrentLanguage = (): Locale => {
  const lang = process.env.LOCALE || 'en';
  return lang as Locale;
};

export const getLocale = (lang: Locale = getCurrentLanguage()) => {
  return locales[lang] || locales.en;
};

export const getTranslations = () => {
  const lang = getCurrentLanguage();
  return getLocale(lang);
};
```

* Reads current language from `LOCALE` env var (defaults to `en`)
* `getTranslations()` returns translations for the current locale in one call

---

## Test File Using i18n with Simplified API

### Before (Hardcoded UI Strings)

```ts
test("Verify that TechDocs is visible in sidebar", async () => {
  await uiHelper.openSidebarButton("Favorites");
  await uiHelper.openSidebar("Docs");
});

test("Verify that TechDocs Docs page for Red Hat Developer Hub works", async ({ page }) => {
  await uiHelper.openSidebarButton("Favorites");
  await uiHelper.openSidebar("Docs");
  await page.getByRole("link", { name: "Red Hat Developer Hub" }).click();
  await uiHelper.waitForTitle("Getting Started running RHDH", 1);
});
```

---

### After (Using Simplified `getTranslations()`)

```ts
import { getTranslations } from "../../support/translations/techdocs";

const t = getTranslations();

test("Verify that TechDocs is visible in sidebar", async () => {
  await uiHelper.openSidebarButton(t.sidebar.favorites);
  await uiHelper.openSidebar(t.sidebar.docs);
});

test("Verify that TechDocs Docs page for Red Hat Developer Hub works", async ({ page }) => {
  await uiHelper.openSidebarButton(t.sidebar.favorites);
  await uiHelper.openSidebar(t.sidebar.docs);
  await page.getByRole("link", { name: t.techdocs.linkName }).click();
  await uiHelper.waitForTitle(t.techdocs.pageTitle, 1);
});
```

---

## Running Tests in Different Languages

Set the `LOCALE` environment variable to run tests in your desired language:

```bash
LOCALE=fr npx playwright test
LOCALE=de npx playwright test
```

If not set, tests default to English (`en`).

---

## Adding a New Locale to Localization Tests

To support a new language (locale) in your E2E tests, follow these steps:

### 1. **Create a Translation File**

Create a new translation file inside the `translations/` folder following the naming convention `<lang>.ts`. For example, to add Spanish:

**`support/techdocs/translations/es.ts`**

```ts
export const es = {
  sidebar: {
    favorites: "Favoritos",
    docs: "Documentación",
  },
  techdocs: {
    linkName: "Red Hat Developer Hub",
    pageTitle: "Empezando con RHDH",
  },
};
```

Ensure the structure matches the other locale files (`en.ts`, `fr.ts`, etc.).

---

### 2. **Update the Translation Loader (`index.ts`)**

Import your new locale and add it to the `locales` object:

```ts
import { en } from './en';
import { fr } from './fr';
import { de } from './de';
import { es } from './es'; // Add this line

export const locales = { en, fr, de, es }; // And this line
```

No changes are required in test files, as they dynamically load the locale using the `LOCALE` environment variable.

---

### 3. **Run Tests in the New Locale**

Use the `LOCALE` environment variable to execute tests in the new language:

```bash
LOCALE=es npx playwright test
```

---

## Summary

| Concept             | Description                                                   |
| ------------------- | ------------------------------------------------------------- |
| Translation files   | Language-specific key-value mappings (`en.ts`, `fr.ts`, etc.) |
| `getTranslations()` | Fetches translations for the active locale in one call        |
| `t.variable`        | Translation keys used in tests instead of hardcoded text      |
| `LOCALE` env var    | Controls which language tests run in                          |

---

With this setup, your tests are multilingual-ready, allowing you to catch UI issues across locales efficiently and with a simplified API. 