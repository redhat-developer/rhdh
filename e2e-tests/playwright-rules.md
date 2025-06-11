# Playwright Testing Rules and Best Practices

## Test Structure and Organization

- Use descriptive and meaningful test names that clearly describe the expected behavior
- Utilize Playwright fixtures (e.g., `test`, `page`, `expect`) to maintain test isolation and consistency
- Use `test.beforeEach` and `test.afterEach` for setup and teardown to ensure a clean state for each test
- Keep tests DRY (Don't Repeat Yourself) by extracting reusable logic into helper functions

## Locators and Selectors

- Avoid using `page.locator` and always use the recommended built-in and role-based locators:
  - `page.getByRole`
  - `page.getByLabel`
  - `page.getByText`
  - `page.getByTitle`
- Use `page.getByTestId` whenever `data-testid` is defined on an element or container
- Reuse Playwright locators by using variables or constants for commonly used elements

## Configuration

- Use the `playwright.config.ts` file for global configuration and environment setup
- Implement proper error handling and logging in tests to provide clear failure messages
- Use projects for multiple browsers and devices to ensure cross-browser compatibility
- Use built-in config objects like `devices` whenever possible

## Assertions and Waiting

- Prefer to use web-first assertions (`toBeVisible`, `toHaveText`, etc.) whenever possible
- Use `expect` matchers for assertions (`toEqual`, `toContain`, `toBeTruthy`, `toHaveLength`, etc.)
- Avoid using `assert` statements
- Avoid hardcoded timeouts
- Use `page.waitFor` with specific conditions or events to wait for elements or states

## Test Quality

- Ensure tests run reliably in parallel without shared state conflicts
- Add JSDoc comments to describe the purpose of helper functions and reusable logic
- Focus on critical user paths, maintaining tests that are stable, maintainable, and reflect real user behavior

## Documentation

For more detailed information and best practices, refer to the official Playwright documentation:
https://playwright.dev/docs/writing-tests
