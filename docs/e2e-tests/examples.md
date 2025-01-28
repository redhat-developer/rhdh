# Examples for e2e tests

## Basics

At this point in time, the framework mixes a few tests with [Fixtures](https://playwright.dev/docs/test-fixtures) and some others with [`beforeEach/All` and `afterEach/All`](https://playwright.dev/docs/api/class-test).
Some contraints in the current architecture do not facilitate the use of Fixture, but it is prefered as it is considered a good practice.

You can see an examples of fixture usage at [github discovery test](../../e2e-tests/playwright/e2e/github-discovery.spec.ts).

An example on the before/after approach is the [github happy path](../../e2e-tests/playwright/e2e/github-happy-path.spec.ts), but almoust any test that you will find at e2e will follow this approach.

Also, note that some test (like [github happy path](../../e2e-tests/playwright/e2e/github-happy-path.spec.ts)) uses a global page variable `let page: Page;`. This is used to avoid reauthentications on the test due to the current rate limits on github.

## Types of tests

Almost all test are related to testing the frontend functionalities of the app and plugins like all the tests related to catalog, learning page or the ones under `/plugins`.

Some other notable ones are:

- Integration with Github: `github-discovery.spec, github-integration-org-fetch.spec, github-happy-path.spec.ts`
- Checks on OC cluster elements like `verify-redis-cache.spec`

Besides, there are many other tests realted to different authentication providers, like `google-signin-happy-path.spec` or `guest-signin-happy-path.spec`, and all under `/authProviders`
