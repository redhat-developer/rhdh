# End-to-End Testing Guide for RHDH Internationalization (i18n)

**Authors**: HusneShabbir  
**Version**: 1.0  
**Purpose**: Comprehensive guide for implementing and testing i18n in RHDH application using Playwright  
**Audience**: QA Engineers and Developers

## Overview

This guide provides comprehensive patterns and best practices for implementing end-to-end tests for internationalization in the RHDH application using Playwright. It focuses on maintaining a robust test infrastructure across multiple languages.

## Project Structure

```
my-playwright-project/
├── translations/           # Internationalization directory
│   ├── en.ts              # English translations
│   ├── fr.ts              # French translations
│   ├── de.ts              # German translations
│   └── index.ts           # Exports locale utilities
├── tests/
│   └── rhdh.spec.ts       # RHDH application tests
└── playwright.config.js    # Playwright configuration
```

## Implementation Guide

### 1. Setting Up the Translation System

#### Create a new language file in `translations/` directory

Each language file should export an object with translated strings:

```typescript
// translations/en.ts
export const en = {
    "rhdhLanguage": "English"
    // Add other RHDH-specific translations
}

// translations/fr.ts
export const fr = {
    "rhdhLanguage": "Français"
    // Add other RHDH-specific translations
}
```

#### Create Translation Utilities (`translations/index.ts`)

```typescript
import { en } from './en';
import { fr } from './fr';
import { de } from './de';

export const locales = { en, fr, de };
export type Locale = keyof typeof locales;

export const getCurrentLanguage = (): Locale => {
  const lang = process.env.TEST_LANG || 'en';
  return lang as Locale;
};

export const getLocale = (lang: Locale = getCurrentLanguage()) => {
  return locales[lang] || locales.en;
};
```

### 2. Configure Playwright

Update `playwright.config.js` to support language switching and test suites:

```javascript
const lang = process.env.TEST_LANG || 'en';

export default defineConfig({
  use: {
    locale: lang, // Set browser locale globally
  },
  
    // rest of config
});
```

### 3. Writing Tests

#### Basic Test Structure

```typescript
import { test, expect } from '@playwright/test';
import { getLocale, getCurrentLanguage } from '../translations';

const lang = getCurrentLanguage();
const t = getLocale();

test.describe(`RHDH Localization - ${lang}`, () => {
  test(`should display correct language section ARIA content in ${lang}`, async ({ page }) => {
    await page.goto('http://localhost:3000/settings');
    const enterButton = page.getByRole('button', { name: 'Enter' });
    await expect(enterButton).toBeVisible();
    await enterButton.click();
    
    await page.getByRole('button', { name: 'Hide' }).click();
    await expect(page.getByTestId('select').locator('p')).toContainText(t.rhdhLanguage);
  });
});
```

### 4. Running Tests

#### Using Localized Test Project
The configuration includes a dedicated project for localization testing:

```javascript
// playwright.config.js
projects: [
  {
    name: 'localized-smoke-suite',
    testMatch: '**/tests/*.spec.ts',
    use: {
      ...devices['Desktop Chrome'],
      locale: lang, // Uses TEST_LANG environment variable
    },
    retries: process.env.CI ? 2 : 0,
  },
  // ... other browser configurations
]
```

#### Single Language with Localized Project - Default Language (English)
```bash
npx playwright test --project=localized-smoke-suite
```

#### Specific Language with Localized Project
```bash
TEST_LANG=fr npx playwright test --project=localized-smoke-suite
```

#### Running Single Test File with Different Locales
To run a specific test file with different locales, you can use the file path with the test command:

```bash
# Run single test in French
TEST_LANG=fr npx playwright test tests/locale.spec.ts --project=localized-smoke-suite
TEST_LANG=fr npx playwright test tests/locale.spec.ts --project=chromium 
TEST_LANG=fr npx playwright test tests/locale.spec.ts --project=firefox 
TEST_LANG=fr npx playwright test tests/locale.spec.ts --project=webkit 


# Run specific test file with specific locale and grep for test name
TEST_LANG=de npx playwright test tests/rhdh.spec.ts --grep "should display correct language" --project=localized-smoke-suite
```

These commands are particularly useful when:
- Debugging localization issues in a specific test
- Validating a new locale implementation for a specific feature
- Running focused tests during development
- Verifying translations for a particular component or page

## Best Practices and Guidelines

1. **Translation Management**
   - Keep translations in separate files per language
   - Use TypeScript for type safety
   - Maintain consistent key structure across all language files

2. **Test Design**
   - Write language-agnostic tests
   - Use role-based selectors when possible
   - Avoid hardcoded text in selectors
   - Include proper error messages for failed assertions

3. **Configuration**
   - Set default language in Playwright config
   - Use environment variables for language selection
   - Configure proper fallbacks for missing translations

4. **Continuous Integration**
   - Run tests in all supported languages
   - Include language coverage in test reports
   - Set up parallel execution for different languages

## Common Pitfalls and Solutions

1. **Text Comparison Issues**
   ```typescript
   // ❌ Direct string comparison might fail
   await expect(element).toHaveText("Hello");
   
   // ✅ Use translation keys
   await expect(element).toHaveText(t.greeting);
   ```

2. **Dynamic Content Handling**
   ```typescript
   // ✅ Use regular expressions for partial matches
   await expect(element).toMatch(new RegExp(t.dynamicContent));
   ```

## Testing Checklist

- [ ] **Setup**
  - [ ] Translation files created for all supported languages
  - [ ] Utility functions implemented
  - [ ] Playwright configured for localization

- [ ] **Test Coverage**
  - [ ] Basic content tests
  - [ ] Dynamic content tests
  - [ ] Language switching tests
  - [ ] Error scenarios

- [ ] **Validation**
  - [ ] Tests pass in all supported languages
  - [ ] Proper error reporting
  - [ ] CI/CD integration

## Success Metrics

1. **Test Coverage**: All supported languages are tested
2. **Maintenance**: Easy to add new languages
3. **Reliability**: Tests pass consistently across languages
4. **Performance**: Efficient test execution time

Remember: The goal is to create maintainable, reliable tests that effectively validate your application's internationalization features while being easy to extend for new languages and features.
