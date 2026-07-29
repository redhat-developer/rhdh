# Writing tests in this repository

This guide covers **how to write** a test at Layers 1–3 in `rhdh`: which utilities to
import, which file to copy, and what to assert.

It deliberately does **not** re-explain _which_ layer to choose — that already exists:

- [`docs/e2e-tests/layer-migration-matrix.md`](e2e-tests/layer-migration-matrix.md) —
  layer definitions and the migration rule of thumb.
- The `test-placement` skill in
  [redhat-developer/rhdh-skill](https://github.com/redhat-developer/rhdh-skill) —
  interactive routing across `rhdh`, `rhdh-plugins` and `rhdh-plugin-export-overlays`.

## Start from the shape of your change

| You changed…                                   | Layer   | Where the test goes                       |
| ---------------------------------------------- | ------- | ----------------------------------------- |
| A pure function or a router built by hand      | **L1**  | next to the code, `*.test.ts`             |
| A backend plugin's wiring and HTTP surface     | **L2**  | next to the code, `*.integration.test.ts` |
| A React component or page                      | **L3**  | `packages/app/src/**/*.test.tsx`          |
| How a dynamic plugin loads into the real app   | **L4a** | `e2e-tests/`, cluster-free harness        |
| Helm, Operator, ingress, a real IdP or cluster | **L4b** | `e2e-tests/playwright/e2e/**`             |

Two terms in circulation here are ambiguous — prefer naming the layer:

- **"a frontend test"** is usually **L3**. It only becomes **L4a** when a _dynamic
  plugin_ has to be loaded into a real app shell.
- **"an integration test"** may mean **L2** (backend plus `supertest`, external
  dependencies mocked) or system integration (**L4a/L4b**). These have very different
  costs.

## Layer 1 — unit

Plain Jest through `@backstage/cli`. Construct the unit under test directly; mock its
collaborators. For a backend router that means building an `express` app yourself and
driving it with `supertest`, without booting a backend.

Utilities: `mockServices`, `createMockDirectory` from `@backstage/backend-test-utils`;
`express`; `supertest`.

Worked example:
[`plugins/scalprum-backend/src/service/router.test.ts`](../plugins/scalprum-backend/src/service/router.test.ts)
— table-driven cases over `createRouter`, with a mock directory standing in for
plugin content on disk.

## Layer 2 — backend integration

Boots the **real plugin** in a test backend and asserts over HTTP. This is the layer
that proves your plugin's wiring — routes, service dependencies, auth policy — is
actually correct, which L1 cannot show.

Utilities: `startTestBackend`, `mockServices`, `createMockDirectory` from
`@backstage/backend-test-utils`; `supertest`. Use `createServiceFactory` from
`@backstage/backend-plugin-api` to substitute a service the plugin depends on.

```ts
const { server } = await startTestBackend({
  features: [myPlugin, stubbedServiceFactory, mockServices.rootConfig.factory()],
});
const response = await request(server).get('/api/my-plugin/things');
```

Worked example:
[`plugins/scalprum-backend/src/service/router.integration.test.ts`](../plugins/scalprum-backend/src/service/router.integration.test.ts)

**Assert the HTTP contract** — status codes, response shape, what an unauthenticated
caller receives. **Do not assert the wiring itself**; that the plugin booted at all is
already implied by the request succeeding. Give these tests a generous timeout
(`30_000`), since booting a backend is slower than a unit test.

If the plugin needs a database, `@backstage/backend-test-utils` provides `TestDatabases`.

## Layer 3 — component

React components and pages rendered in a Backstage test app.

Utilities: `renderInTestApp`, `TestApiProvider` from **`@backstage/frontend-test-utils`**
— note the package name, it is _not_ `@backstage/test-utils`; `screen` and friends from
`@testing-library/react`.

```tsx
renderInTestApp(
  <TestApiProvider apis={[[searchApiRef, searchApiMock]]}>
    <MyPage />
  </TestApiProvider>,
);
```

Worked examples in `packages/app/src`:
[`components/learningPaths/LearningPathsPage.test.tsx`](../packages/app/src/components/learningPaths/LearningPathsPage.test.tsx)
(page with a mocked API),
[`components/UserSettings/InfoCard.test.tsx`](../packages/app/src/components/UserSettings/InfoCard.test.tsx)
and
[`components/Root/CustomSidebarItem.test.tsx`](../packages/app/src/components/Root/CustomSidebarItem.test.tsx).

Prefer L3 over L4a whenever no dynamic-plugin loading is involved.

## Layers 4a and 4b

Not covered here:

- **L4a**, cluster-free — [`docs/e2e-tests/local-e2e-harness.md`](e2e-tests/local-e2e-harness.md)
- **L4b**, cluster — [`e2e-tests/README.md`](../e2e-tests/README.md)

## Running tests

```bash
yarn test                 # everything, via turbo
yarn test --filter=app    # one package
yarn tsc                  # type-check
yarn lint:check --affected
```

## What CI runs on your pull request

- **Test with Node.js** (`.github/workflows/pr.yaml`) — Layers 1–3. Required.
- **Build with Node.js** (same workflow) — required.
- **E2E cluster-free** (`.github/workflows/e2e-cluster-free.yaml`) — Layer 4a.
  Path-filtered, so it does not run on every PR.
- **Cluster E2E** — Layer 4b, through Prow. See [`docs/e2e-tests/CI.md`](e2e-tests/CI.md).

## Coverage

Coverage is reported to Codecov and is **informational only**. Both the `project` and
`patch` status checks in [`codecov.yml`](../codecov.yml) set `informational: true`, so
**a coverage number cannot block a pull request**, and there is no minimum threshold to
meet.

This is deliberate. Justify a test by the failure it would catch, not by the coverage
percentage it adds.
