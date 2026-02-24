---
targets:
  - '*'
root: false
description: Best practices for using Playwright locators in RHDH e2e tests
globs:
  - e2e-tests/**
cursor:
  description: Best practices for using Playwright locators in RHDH e2e tests
  globs:
    - e2e-tests/**
---
# Playwright Locator Best Practices

## Locator Priority (Use in Order)

1. **`page.getByRole(role, { name })`** - Interactive elements, headings (reflects user perception)
2. **`page.getByLabel(text)`** - Form controls with labels
3. **`page.getByPlaceholder(text)`** - Inputs without labels
4. **`page.getByText(text)`** - Non-interactive content only (avoid for buttons/links - use getByRole instead)
5. **`page.getByAltText(text)`** - Images
6. **`page.getByTitle(text)`** - Elements with title attribute
7. **`page.getByTestId(id)`** -  When semantic locators unavailable (uses `data-testid` attribute only)
8. **`page.locator(selector)`** - Avoid CSS/XPath unless necessary

## Quick Examples

```typescript
// ✅ GOOD - Semantic locators
await page.getByRole('button', { name: 'Submit' }).click();
await page.getByLabel('Username').fill('admin');
await page.getByPlaceholder('Search...').type('test');
await expect(page.getByText('Welcome')).toBeVisible();

// ✅ GOOD - Filtering and chaining
await page.getByRole('row')
  .filter({ hasText: 'Guest User' })
  .getByRole('button', { name: 'Edit' })
  .click();

// ❌ BAD - Using getByText for interactive elements
await page.getByText('Submit').click(); // Use getByRole('button', { name: 'Submit' }) instead

// ❌ BAD - Implementation-dependent selectors
await page.locator('.MuiButton-label').click();
await page.locator('div:nth-child(3)').click();
await page.locator('//*[@id="form"]/div[2]/input').fill('test');
```

## Anti-Patterns

- ❌ CSS class selectors (`.MuiButton-label`, `[class*="MuiTableCell"]`, `.MuiDataGrid-*`)
- ❌ Long XPath chains
- ❌ `nth-child` without semantic context
- ❌ Using `force: true` to bypass checks
- ❌ Mixing locator strategies inconsistently
- ❌ Using getByText for buttons or links (use getByRole instead)
- ❌ Targeting dynamically generated text (dynamic status, timestamps)
- ❌ Configuring custom test ID attributes (stick with `data-testid` only)
- ❌ Selecting elements without scoping (may match from wrong card/dialog)

## Assertions with Auto-Waiting

Playwright assertions automatically wait and retry (default: 5 seconds) until conditions are met. No manual waits needed.

```typescript
// ✅ Auto-waiting assertions
await expect(page.getByRole('button', { name: 'Submit' })).toBeVisible();
await expect(page.getByLabel('Status')).toHaveText('Submitted');
await expect(page.getByRole('list')).toHaveCount(5);

// ❌ Unnecessary manual waiting
await page.waitForSelector('.status'); // Don't do this, expect() waits automatically
```

**Common assertions**: `toBeVisible()`, `toBeHidden()`, `toBeEnabled()`, `toBeDisabled()`, `toBeChecked()`, `toHaveText()`, `toContainText()`, `toHaveValue()`, `toHaveCount()`, `toHaveAttribute()`

**Auto-checks before actions**: Visible, Stable (not animating), Enabled, Editable, Receives Events (not obscured)

## Filtering & Chaining

```typescript
// Filter by text or child elements
const row = page.getByRole('listitem').filter({ hasText: 'Product 2' });
const card = page.getByRole('article').filter({ 
  has: page.getByRole('button', { name: 'Delete' }) 
});

// Narrow scope with chaining
await page.getByTestId('dialog')
  .getByRole('button', { name: 'OK' })
  .click();

// Handle alternatives with .or()
const btn = page.getByRole('button', { name: 'New' });
const dialog = page.getByText('Confirm settings');
await expect(btn.or(dialog).first()).toBeVisible();
```

## Working with DataGrid Tables

```typescript
// ✅ GOOD - Use role-based locators for grids
await page.getByRole('grid').getByRole('row').filter({ hasText: 'Guest User' })
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

## Page Objects

```typescript
// ✅ Return locators, not elements
class CatalogPage {
  constructor(private page: Page) {}

  getSearchInput(): Locator {
    return this.page.getByPlaceholder('Search');
  }

  getComponentLink(name: string): Locator {
    return this.page.getByRole('link', { name });
  }

  async findComponent(searchTerm: string): Promise<void> {
    await this.getSearchInput().fill(searchTerm);
    await this.getSearchInput().press('Enter');
  }
}
```

## Debugging

```bash
# Generate locators automatically
yarn playwright codegen http://localhost:7007

# Debug tests step-by-step
yarn playwright test --debug

# Or pause in test
await page.pause();
```

## Resources

- **Full Guide**: `docs/e2e-tests/playwright-locator-best-practices.md`
- **Official Docs**: https://playwright.dev/docs/locators
- **Best Practices**: https://playwright.dev/docs/best-practices

## Remember

Good locators reflect how users interact with your app. Ask: "How would a user or screen reader find this element?"
