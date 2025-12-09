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
| ⭐⭐⭐⭐ | `getByText()` | Non-interactive content only (avoid for buttons/links) | `page.getByText('Welcome')` |
| ⭐⭐⭐⭐ | `getByAltText()` | Images | `page.getByAltText('Logo')` |
| ⭐⭐⭐ | `getByTitle()` | Elements with title | `page.getByTitle('Settings')` |
| ⭐⭐ | `getByTestId()` | Complex components (uses `data-testid` only) | `page.getByTestId('user-menu')` |
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
await page.locator('.MuiDataGrid-row').click();
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

### Using getByText for Interactive Elements
Use `getByRole` instead for buttons and links.

```typescript
// ❌ BAD
await page.getByText('Submit').click();

// ✅ GOOD
await page.getByRole('button', { name: 'Submit' }).click();
```

### Targeting Dynamically Generated Text
Avoid selectors based on text that changes (timestamps, statuses).

```typescript
// ❌ BAD
await page.getByText('Last updated: 2:45 PM').click();
```

### Configuring Custom Test ID Attributes
Stick with Playwright's default `data-testid` attribute.

```typescript
// ❌ BAD - Don't configure custom attributes
// playwright.config.ts
use: { testIdAttribute: 'data-custom-id' }
```

### Selecting Without Scoping
May match elements from wrong card or dialog.

```typescript
// ❌ BAD
await page.getByRole('row').first().click(); // Could match row from any grid on page

// ✅ GOOD
await page.getByTestId('users-card')
  .getByRole('row')
  .first()
  .click();
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

## Assertions with Auto-Waiting

Playwright assertions automatically wait and retry (default: 5 seconds) until conditions are met. This eliminates flakiness.

```typescript
// ✅ GOOD - Auto-waiting assertions
await expect(page.getByRole('button', { name: 'Submit' })).toBeVisible();
await expect(page.getByLabel('Status')).toHaveText('Submitted');
await expect(page.getByRole('list')).toHaveCount(5);
await expect(page).toHaveURL(/.*dashboard/);

// ❌ BAD - Unnecessary manual waiting
await page.waitForSelector('.status');
await expect(page.locator('.status')).toHaveText('Submitted');
```

### Common Auto-Waiting Assertions

| Assertion | Purpose | Example |
|-----------|---------|---------|
| `toBeVisible()` | Element is visible | `await expect(locator).toBeVisible()` |
| `toBeHidden()` | Element is not visible | `await expect(locator).toBeHidden()` |
| `toBeEnabled()` | Element is enabled | `await expect(locator).toBeEnabled()` |
| `toBeDisabled()` | Element is disabled | `await expect(locator).toBeDisabled()` |
| `toBeChecked()` | Checkbox is checked | `await expect(locator).toBeChecked()` |
| `toBeEditable()` | Element is editable | `await expect(locator).toBeEditable()` |
| `toHaveText()` | Exact text match | `await expect(locator).toHaveText('Submit')` |
| `toContainText()` | Partial text match | `await expect(locator).toContainText('Success')` |
| `toHaveValue()` | Input has value | `await expect(locator).toHaveValue('test')` |
| `toHaveCount()` | List has N items | `await expect(locator).toHaveCount(5)` |
| `toHaveAttribute()` | Element has attribute | `await expect(locator).toHaveAttribute('href', '/')` |

### Actionability Checks

Playwright automatically performs these checks before actions:

- **Visible**: Non-empty bounding box, not `visibility:hidden`
- **Stable**: Same bounding box for 2+ animation frames
- **Enabled**: Not disabled or in disabled fieldset
- **Editable**: Enabled and not readonly
- **Receives Events**: Element is the hit target (not obscured)

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

## Working with DataGrid Tables

When working with MUI DataGrid or similar table components, use semantic role-based locators and avoid MUI class names.

```typescript
// ✅ GOOD - Use role-based locators for grids
await page.getByRole('grid')
  .getByRole('row')
  .filter({ hasText: 'Guest User' })
  .getByRole('button', { name: 'Edit' })
  .click();

await page.getByRole('columnheader', { name: 'Name' }).click();

// ✅ GOOD - Filter rows by text content
const userRow = page.getByRole('row').filter({ hasText: 'john@example.com' });
await expect(userRow).toBeVisible();

// ✅ GOOD - Scope within specific container to avoid conflicts
await page.getByTestId('users-card')
  .getByRole('grid')
  .getByRole('row')
  .filter({ hasText: 'Active' })
  .click();

// ❌ BAD - MUI class names (brittle, changes frequently)
await page.locator('.MuiDataGrid-row').click();
await page.locator('.MuiDataGrid-columnHeader').click();
await page.locator('[class*="MuiDataGrid"]').click();

// ❌ BAD - Selecting from wrong context
await page.getByRole('row').first().click(); // Could match row from any grid on page
```

### Key Points for DataGrid Tables

- **Prefer** `getByRole('grid')`, `getByRole('row')`, `getByRole('columnheader')`
- **Never use** MUI class names like `.MuiDataGrid-*` (they change frequently and cause flakes)
- **Use** `.filter({ hasText })` to reliably target rows
- **Use** chaining/scoping to avoid selecting elements from outside the intended card or dialog

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
yarn playwright codegen http://localhost:7007

# With authentication
yarn playwright codegen --load-storage=auth.json http://localhost:7007
```

### Debug Mode

```bash
# Debug all tests
yarn playwright test --debug

# Debug specific test
yarn playwright test rbac.spec.ts --debug
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
