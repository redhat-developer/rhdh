# Contributing

We are excited that you want to be a part of this project by contributing to the end-to-end tests. Here is some information on how to get started, as well as our requirements and guidelines to ensure a smooth contribution process.

## Getting Started

Before you begin, please ensure you have followed the general setup instructions in the main [Contributing Guide](../../CONTRIBUTING.md) to clone the repository and install dependencies.
**The [Readme](README.md) file contains practical information about the e2e project**

## Contribution Guidelines

We welcome both code and non-code contributions to our project. Non-code contributions can come in the form of documentation updates, enhancement requests, and new test requests.

### Developer Guidelines

These principles are valid for new contributions. Some parts of the codebase may not adhere yet to these principles, but improvements should be made in that direction.

#### Architectural Principles

1. **Naming Convention**

   A naming convention is enforced for all entities, including variables, functions, and file names. Consistent naming ensures code clarity, maintainability, and ease of navigation throughout the project.

2. **Code Visibility**

   Carefully consider the visibility of all classes, variables, and functions. Exposed elements should be simple and understandable on the frontend while being versatile and resilient in the background. This promotes a clean and user-friendly API while maintaining robust internal functionality.

3. **Test Isolation**

   All tests should be written to be as isolated as possible. Even if current constraints (such as GitHub login rate limits) prevent complete independence, strive for maximum isolation. This approach ensures that when blockers are removed, refactoring can proceed smoothly.

4. **Control Over Test Environment**

   The test framework must have full control over the test environment. All environment configurations should be managed and propagated up to the Node.js layer, when possible. This ensures that the test environtment can be set up in case-to-case bases.

5. **Team Agreement on Architecture Principles**

   All architecture principles and guidelines must be agreed upon by the team. Every team member's voice is important, and open communication ensures alignment and shared understanding of the project's direction.

6. **General Rules**

   All tests have to follow a set of simple rules:
   I. Check the preconditions. If tests are running in parallel, try to create the preconditions you need to avoid race conditions.
   II. Each test has to test one and only one thing.
   III. All tests have to contain preconditions, actions, and assertions, like you whould do in [Gherkin](https://cucumber.io/docs/guides/overview/); think in those terms.

#### Technical Guidelines

1. **Page Object Model (POM)**

   The Page Object Model (POM) design pattern is required for all test code. Until we find a better-suited standard, we adhere to this well-known and well-tested pattern to promote code reusability and maintainability.

2. **Playwright Best Practices**

   We follow Playwright best practices, including the use of fixtures. Adhering to these practices ensures that our tests are reliable, efficient, and maintainable. Please refer to the [Playwright Best Practices](https://playwright.dev/docs/best-practices) and [Fixtures](https://playwright.dev/docs/test-fixtures) documentation for guidance.

   - Prefer the shared fixtures from `@support/coverage/test` instead of re-implementing login/setup in each spec:
     - Use `guestPage` for ordinary specs that need a fresh guest login per test (best isolation; default choice).
     - Use `rhdhGuestPage` or `rhdhPage` only when a describe block intentionally shares one browser context/page across tests (for example to avoid repeated guest login or amortize expensive setup).
   - Worker-scoped fixtures (`rhdhPage`, `rhdhGuestPage`, `rhdhContext`, `rhdhAuthSession`) do **not** require `test.describe.configure({ mode: "serial" })` by themselves. With the default Playwright config, tests in a file already run sequentially in one worker.
   - When sharing a worker-scoped page/context across multiple tests, reset browser state between tests (sign out, `clearCookies`, or a harness `cleanup` callback) so each test stays independent.
   - Use `test.describe.configure({ mode: "serial" })` (or `test.describe.serial`) **only** when a later test depends on side effects from an earlier test in the same file—for example, import an entity in test 1 and verify it in test 2. Do not add serial merely because worker fixtures are present.

3. **Avoid Using `uiHelper` in Spec Files**

   - The `uiHelper` utility should not be used directly in spec files. The reason for that is that some methods in this class are too generic and sometimes it is difficult to point what they are intended. Idellay, they shall be called from inside a POM that states what thay are looking for.
   - Use `uiHelper` methods only within the Page Object Model (POM) classes.
   - When working with tests that directly use `uiHelper` in spec files, refactor them to move `uiHelper` usage into POM classes.
   - This ensures that all UI interactions are encapsulated within page objects, promoting cleaner and more maintainable test code.

4. **Blocked Flows**

   - If a flow is blocked by a known product issue, keep it out of the default `*.spec.ts` Playwright discovery path until it can run deterministically again.
   - Preserve the Jira or bug reference in the filename comments and/or documentation so the test can be restored once the blocker is fixed.

5. **Use External Sources for Validation**

   - **Avoid Hardcoded Data in Tests**

     - When validating frontend results in your end-to-end tests, use external sources of truth such as APIs or databases instead of hardcoded information.
     - This approach ensures that tests are more robust and accurately reflect the dynamic nature of the application data.

### Adding New Tests

When contributing new tests or modifying existing ones, please adhere to the guidelines.
To open a PR, follow the steps described in the [general contribution guide](../../CONTRIBUTING.md)

### Verify Affected CI Jobs Before Merging

Changing e2e specs or shared e2e infrastructure (fixtures, `global-setup.ts`, `playwright.config.ts`, deploy helpers, auth harness, localization) can break nightly or optional jobs that do **not** run automatically on every PR.

On your PR:

1. Comment `/test ?` to list available Prow jobs for that branch.
2. Comment `/test <job-name>` for each job your change affects (for example `e2e-ocp-helm-nightly`, `e2e-ocp-operator-nightly`, `e2e-ocp-helm-localization-nightly`, `e2e-ocp-operator-auth-providers-nightly`).
3. Wait for those jobs to finish and confirm they still pass, or are not worse than before.

Do not use `/test all` unless you intentionally need every optional job. Details and job naming are in [CI.md](CI.md).

### Collaboration and Communication

- **Team Consensus:**

  - Engage with the team when introducing significant changes. Ensure that architectural decisions are agreed upon collectively.

- **Open Communication:**

  - Encourage discussion and feedback. All voices are important in shaping the project's direction.
