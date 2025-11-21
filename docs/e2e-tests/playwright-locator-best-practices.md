# Playwright Locator Best Practices for RHDH E2E Tests

## Quick Start

**Philosophy:** Locators should reflect how users interact with your application, not how it's implemented.

## Locator Selection Guide

### Quick Decision Tree

```text
📍 Locator Selection
├─ 🎯 Interactive (button/link/heading)?     → getByRole(role, { name })
├─ 🏷️ Form with label?                       → getByLabel(text)
├─ 💬 Input with placeholder?                → getByPlaceholder(text)
├─ 📝 Non-interactive text?                  → getByText(text)
├─ 🖼️ Image?                                 → getByAltText(text)
├─ 📋 Has title attribute?                   → getByTitle(text)
├─ 🔖 No semantic option?                    → getByTestId(id) ⚠️
└─ 🚫 Last resort only                       → locator(css/xpath) ❌
```

### Priority Order with Examples

| Priority | Locator | Use For | Example |
|----------|---------|---------|---------|
| ⭐⭐⭐⭐⭐ | `getByRole()` | Buttons, links, headings, form controls | `page.getByRole('button', { name: 'Submit' })` |
| ⭐⭐⭐⭐⭐ | `getByLabel()` | Form inputs with labels | `page.getByLabel('Username')` |
| ⭐⭐⭐⭐ | `getByPlaceholder()` | Inputs without labels | `page.getByPlaceholder('Search...')` |
| ⭐⭐⭐⭐ | `getByText()` | Non-interactive content | `page.getByText('Welcome')` |
| ⭐⭐⭐⭐ | `getByAltText()` | Images | `page.getByAltText('Logo')` |
| ⭐⭐⭐ | `getByTitle()` | Elements with title | `page.getByTitle('Settings')` |
| ⭐⭐ | `getByTestId()` | Complex components | `page.getByTestId('user-menu')` |
| ⭐ | `locator()` | Last resort | `page.locator('table.stable-class')` |

## Common Roles

| Role | HTML Elements | Example |
|------|--------------|---------|
| `button` | `<button>`, `<input type="button">` | `getByRole('button', { name: 'Submit' })` |
| `link` | `<a href="...">` | `getByRole('link', { name: 'Home' })` |
| `heading` | `<h1>`-`<h6>` | `getByRole('heading', { name: 'Dashboard' })` |
| `textbox` | `<input>`, `<textarea>` | `getByRole('textbox', { name: 'Email' })` |
| `checkbox` | `<input type="checkbox">` | `getByRole('checkbox', { name: 'Agree' })` |
| `row` | `<tr>` | `getByRole('row')` |
| `cell` | `<td>`, `<th>` | `getByRole('cell', { name: 'Value' })` |
| `tab` | `<div role="tab">` | `getByRole('tab', { name: 'Overview' })` |

[Full ARIA roles reference](https://www.w3.org/TR/wai-aria-1.2/#role_definitions)

## ❌ Anti-Patterns to Avoid

### MUI/CSS Class Selectors
Breaks on implementation changes when libraries update their internal class names.

```typescript
// ❌ BAD
await page.locator('.MuiButton-label').click();
await page.locator('div[class*="MuiTableCell-root"]').text();
```

### Long XPath Chains
Brittle and hard to maintain. Breaks with any DOM structure change.

```typescript
// ❌ BAD
await page.locator('//*[@id="form"]/div[2]/div[1]/input').fill('test');
```

### nth-child Without Context
Position-based selectors are fragile and don't reflect user interaction.

```typescript
// ❌ BAD
await page.locator('div:nth-child(3)').click();
```

### Forcing Actions
Bypasses Playwright's actionability checks, hiding real issues.

```typescript
// ❌ BAD
await button.click({ force: true });
```

## ✅ Best Practices

### Use Semantic Locators
Reflect how users and screen readers interact with elements.

```typescript
// ✅ GOOD
await page.getByRole('button', { name: 'Submit' }).click();
await page.getByRole('cell', { name: 'Value' }).textContent();
await page.getByLabel('Username').fill('test');
```

### Use Filtering for Context
Narrow down selections semantically instead of using position.

```typescript
// ✅ GOOD
await page.getByRole('listitem').filter({ hasText: 'Item 3' }).click();
```

### Wait for Actionability
Let Playwright verify the element is ready for interaction.

```typescript
// ✅ GOOD
await button.waitFor({ state: 'enabled' });
await button.click();
```

## Filtering and Chaining

```typescript
// Filter by text
const row = page.getByRole('row').filter({ hasText: 'Guest User' });
await row.getByRole('button', { name: 'Edit' }).click();

// Filter by child element
const productWithButton = page.getByRole('listitem').filter({
  has: page.getByRole('button', { name: 'Buy' })
});

// Chain to narrow scope
const dialog = page.getByTestId('settings-dialog');
await dialog.getByRole('button', { name: 'Save' }).click();

// Handle alternatives
const newBtn = page.getByRole('button', { name: 'New' });
const dialog = page.getByText('Confirm settings');
await expect(newBtn.or(dialog).first()).toBeVisible();
```

## Common Pain Points in RHDH Tests

### 🚨 MUI Class Selectors (Most Common Issue)

**Problem:** The codebase has 100+ instances of MUI class selectors that break when Material-UI updates.

```typescript
// ❌ AVOID - Found in global-obj.ts and throughout tests
const UI_HELPER_ELEMENTS = {
  MuiButtonLabel: 'span[class^="MuiButton-label"]',
  MuiTableCell: 'td[class*="MuiTableCell-root"]',
  MuiCard: (cardHeading) => `//div[contains(@class,'MuiCardHeader-root')]...`
};

// ✅ REFACTOR TO
await page.getByRole('button', { name: 'Submit' });
await page.getByRole('cell', { name: 'Value' });
await page.getByRole('article').filter({ hasText: cardHeading });
```

**Why it matters:** Backstage uses Material-UI extensively. When MUI updates class names, all these selectors break.

### 🚨 Excessive `waitForTimeout()` Usage

**Problem:** 50+ instances of arbitrary timeouts that make tests slow and flaky.

```typescript
// ❌ AVOID - Found in auth-providers, RBAC, and plugin tests
await page.waitForTimeout(3000);  // Why 3 seconds? What are we waiting for?
await button.click();

// ✅ REFACTOR TO - Wait for actual conditions
await button.waitFor({ state: 'visible' });
await button.click();

// Or use auto-waiting assertions
await expect(button).toBeVisible();
await button.click();
```

**Why it matters:** Tests run slower than needed, and arbitrary timeouts don't prevent flakiness—they just hide it.

### 🚨 Force Clicking Bypasses Real Issues

**Problem:** Using `force: true` hides actionability problems.

```typescript
// ❌ AVOID - Found in rbac.spec.ts
await nextButton2.click({ force: true });

// ✅ REFACTOR TO - Fix the underlying issue
await nextButton2.waitFor({ state: 'enabled' });
await nextButton2.scrollIntoViewIfNeeded();
await nextButton2.click();
```

**Why it matters:** If a real user can't click it, your test shouldn't either. Force clicking hides real UX issues.

### 🚨 Inconsistent Locator Strategies

**Problem:** Same elements located differently across tests.

```typescript
// ❌ INCONSISTENT - Found across multiple test files
await page.locator("nav[id='global-header']").click();  // settings.spec.ts
await page.getByRole('navigation').click();              // header.spec.ts
await page.locator("header").click();                    // custom-theme.spec.ts

// ✅ STANDARDIZE ON
await page.getByRole('navigation', { name: 'Global header' });
```

**Why it matters:** Consistency makes tests easier to maintain and understand.

## RHDH Examples

### RBAC Tests

```typescript
// Navigate and create role
await page.getByRole('button', { name: 'Administration' }).click();
await page.getByRole('link', { name: 'RBAC' }).click();
await page.getByRole('button', { name: 'Create' }).click();

// Fill form
await page.getByLabel('name').fill('test-role');
await page.getByLabel('description').fill('Test description');

// Select permissions
await page.getByRole('checkbox', { name: 'catalog.entity.delete' }).check();
await page.getByRole('button', { name: 'Save' }).click();

// Verify
await expect(page.getByText('Role created successfully')).toBeVisible();
```

### Table Interactions

```typescript
// Find specific row and click action
const row = page.getByRole('row').filter({ hasText: 'Guest User' });
await row.getByRole('button', { name: 'Edit' }).click();

// Verify table headers
await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible();
await expect(page.getByRole('columnheader', { name: 'Type' })).toBeVisible();
```

## Debugging

### Playwright Codegen

```bash
# Generate locators automatically
npx playwright codegen http://localhost:7007

# With authentication
npx playwright codegen --load-storage=auth.json http://localhost:7007
```

### Debug Mode

```bash
# Debug all tests
npx playwright test --debug

# Debug specific test
npx playwright test rbac.spec.ts --debug
```

### Pause in Test

```typescript
test('debug locators', async ({ page }) => {
  await page.goto('/rbac');
  await page.pause(); // Opens inspector
  await page.getByRole('button', { name: 'Create' }).click();
});
```

## Migration Strategy

### Step 1: Identify High-Priority Tests
- Tests that run frequently
- Critical path tests
- Flaky tests with fragile selectors

### Step 2: Replace One Locator at a Time

```typescript
// BEFORE
await page.locator('.MuiButton-root').getByText('Submit').click();

// AFTER
await page.getByRole('button', { name: 'Submit' }).click();
```

### Step 3: Run and Verify
- Test after each change
- Use codegen to validate new locators
- Check for strictness violations

## Common Issues

### Multiple Elements Match

```typescript
// ❌ Problem
await page.getByRole('button').click();
// Error: strict mode violation

// ✅ Solution 1: Be specific
await page.getByRole('button', { name: 'Submit' }).click();

// ✅ Solution 2: Filter scope
await page.getByTestId('dialog').getByRole('button').click();
```

### Element Not Found

```typescript
// Debug: Check if element exists
console.log(await page.getByRole('button', { name: 'Submit' }).count());

// Try alternative locators
console.log(await page.getByText('Submit').count());
console.log(await page.locator('button:has-text("Submit")').count());

// Use Inspector
await page.pause();
```

## Resources

- [Playwright Locators](https://playwright.dev/docs/locators)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [ARIA Roles](https://www.w3.org/TR/wai-aria-1.2/#role_definitions)
- [RHDH E2E CI Documentation](../e2e-tests/CI.md)
