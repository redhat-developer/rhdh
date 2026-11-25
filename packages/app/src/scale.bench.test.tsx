/*
 * Copyright 2026 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/*
 * Benchmark for how the frontend system scales with the number of installed
 * plugins, page extensions and entity content extensions.
 *
 * It is skipped unless the BENCH environment variable is set:
 *
 *   BENCH=1 CI=1 yarn test packages/frontend-defaults/src/scale.bench.test.tsx
 *
 * Optional settings:
 *
 *   BENCH_SIZES   Comma separated extension counts for the navigation
 *                 benchmark, defaults to 2,10,50,100,200,400
 *   BENCH_SERIES  Comma separated navigation series to run, any of
 *                 pages-nav, pages-nonav, contents and both
 *
 * Results are printed as lines prefixed with "BENCH". The numbers come from
 * jsdom and a development build of React, so compare them to each other
 * rather than reading them as browser timings.
 */

/* eslint-disable @backstage/no-undeclared-imports, jest/expect-expect */

import {
  ApiBlueprint,
  PageBlueprint,
  createFrontendPlugin,
  createFrontendModule,
  createRouteRef,
  routeResolutionApiRef,
  FrontendFeature,
  RouteRef,
} from "@backstage/frontend-plugin-api";
import { EntityContentBlueprint } from "@backstage/plugin-catalog-react/alpha";
import { catalogApiRef } from "@backstage/plugin-catalog-react";
import catalogPlugin from "@backstage/plugin-catalog/alpha";
import { default as appPluginOriginal } from "@backstage/plugin-app";
import { createSpecializedApp } from "@backstage/frontend-app-api";
import { ConfigReader } from "@backstage/config";
import { act, render, screen } from "@testing-library/react";

const describeBench = process.env.BENCH ? describe : describe.skip;

const appPlugin = appPluginOriginal.withOverrides({
  extensions: [
    appPluginOriginal
      .getExtension("sign-in-page:app")
      .override({ disabled: true }),
  ],
});

const entity = {
  apiVersion: "backstage.io/v1alpha1",
  kind: "Component",
  metadata: { name: "x", namespace: "default" },
  spec: { type: "service", lifecycle: "production", owner: "guests" },
  relations: [],
};

const catalogApiMock: any = new Proxy(
  {
    getEntityByRef: async () => entity,
    getEntitiesByRefs: async () => ({ items: [entity] }),
    getEntities: async () => ({ items: [entity] }),
    queryEntities: async () => ({
      items: [entity],
      totalItems: 1,
      pageInfo: {},
    }),
    getEntityFacets: async () => ({ facets: {} }),
    getEntityAncestors: async () => ({ rootEntityRef: "x", items: [] }),
  },
  {
    get(target: any, prop) {
      return target[prop] ?? (async () => undefined);
    },
  },
);

const catalogMockModule = createFrontendModule({
  pluginId: "catalog",
  extensions: [
    ApiBlueprint.make({
      params: (defineParams) =>
        defineParams({
          api: catalogApiRef,
          deps: {},
          factory: () => catalogApiMock,
        }),
    }),
  ],
});

const log = (msg: string) => process.stdout.write(`BENCH ${msg}\n`);

function median(xs: number[]) {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Wraps the route resolution API of an app so that the number of calls and
 * the time spent in them can be read out.
 */
function instrumentRouteResolution(app: { apis: { get(ref: any): any } }) {
  const api = app.apis.get(routeResolutionApiRef);
  const original = api.resolve.bind(api);
  const stats = { calls: 0, spent: 0 };
  api.resolve = (...args: any[]) => {
    const start = window.performance.now();
    try {
      return original(...args);
    } finally {
      stats.calls++;
      stats.spent += window.performance.now() - start;
    }
  };
  return {
    stats,
    reset() {
      stats.calls = 0;
      stats.spent = 0;
    },
  };
}

/*
 * Part 1: app tree creation and the cost of a single route resolution.
 */

function makeWiringFeatures(opts: {
  plugins: number;
  pagesPerPlugin: (index: number) => number;
  contentsPerPlugin: (index: number) => number;
  modules?: boolean;
}) {
  const features: FrontendFeature[] = [];
  const routeRefs: RouteRef[] = [];
  const extensionIds: string[] = [];

  for (let i = 0; i < opts.plugins; i++) {
    const pluginId = `dyn-${i}`;
    const rootRef = createRouteRef();
    routeRefs.push(rootRef);
    const extensions = [];

    const pageCount = opts.pagesPerPlugin(i);
    for (let p = 0; p < pageCount; p++) {
      extensions.push(
        PageBlueprint.make({
          name: p === 0 ? undefined : `p${p}`,
          params: {
            path: `/dyn-${i}/p${p}`,
            title: `Page ${i}-${p}`,
            icon: <span>i</span>,
            routeRef: p === 0 ? rootRef : undefined,
            loader: async () => <div>page</div>,
          },
        }),
      );
      extensionIds.push(
        p === 0 ? `page:${pluginId}` : `page:${pluginId}/p${p}`,
      );
    }

    const contentCount = opts.contentsPerPlugin(i);
    for (let c = 0; c < contentCount; c++) {
      extensions.push(
        EntityContentBlueprint.make({
          name: `c${c}`,
          params: {
            path: `/dyn-${i}-c${c}`,
            title: `Content ${i}-${c}`,
            filter: { kind: "component" },
            loader: async () => <div>content</div>,
          },
        }),
      );
      extensionIds.push(`entity-content:${pluginId}/c${c}`);
    }

    features.push(
      createFrontendPlugin({
        pluginId,
        title: `Dyn ${i}`,
        routes: pageCount > 0 ? { root: rootRef } : {},
        extensions,
      }),
    );

    if (opts.modules) {
      features.push(
        createFrontendModule({
          pluginId,
          extensions: [
            PageBlueprint.make({
              name: "from-module",
              params: {
                path: `/dyn-${i}/mod`,
                loader: async () => <div>mod</div>,
              },
            }),
          ],
        }),
      );
    }
  }

  return { features, routeRefs, extensionIds };
}

function runWiring(
  label: string,
  opts: Parameters<typeof makeWiringFeatures>[0] & {
    configEntries?: boolean;
  },
) {
  const { features, routeRefs, extensionIds } = makeWiringFeatures(opts);
  const config = new ConfigReader({
    app: {
      extensions: opts.configEntries
        ? extensionIds.map((id) => ({ [id]: { config: {} } }))
        : [],
    },
  });

  const createStart = window.performance.now();
  const app = createSpecializedApp({
    features: [appPlugin, catalogPlugin, ...features],
    config,
  });
  const createMs = window.performance.now() - createStart;

  const routeApi = app.apis.get(routeResolutionApiRef)!;
  const iterations = 200;
  const resolveStart = window.performance.now();
  for (let i = 0; i < iterations; i++) {
    routeApi.resolve(routeRefs[i % routeRefs.length], {
      sourcePath: "/catalog/default/component/x",
    })?.();
  }
  const resolveMs = (window.performance.now() - resolveStart) / iterations;

  log(
    `${label} | nodes=${app.tree.nodes.size} errors=${
      app.errors?.length ?? 0
    } create=${createMs.toFixed(0)}ms resolve=${resolveMs.toFixed(3)}ms/call`,
  );
}

/*
 * Part 2: time for a route change with a rendered app.
 */

function makeNavigationFeatures(opts: {
  pages: number;
  contents: number;
  nav: boolean;
}) {
  const features: FrontendFeature[] = [];
  const total = Math.max(opts.pages, opts.contents);

  for (let i = 0; i < total; i++) {
    const rootRef = createRouteRef();
    const extensions = [];

    if (i < opts.pages) {
      extensions.push(
        PageBlueprint.make({
          params: {
            path: `/dyn-${i}`,
            title: `Page ${i}`,
            // Pages without an icon are not picked up as sidebar items
            icon: opts.nav ? <span>i</span> : undefined,
            routeRef: rootRef,
            loader: async () => <div>page-body-{i}</div>,
          },
        }),
      );
    }
    if (i < opts.contents) {
      extensions.push(
        EntityContentBlueprint.make({
          params: {
            path: `/dyn-${i}`,
            title: `Content ${i}`,
            filter: { kind: "component" },
            loader: async () => <div>content-body-{i}</div>,
          },
        }),
      );
    }

    features.push(
      createFrontendPlugin({
        pluginId: `dyn-${i}`,
        routes: i < opts.pages ? { root: rootRef } : {},
        extensions,
      }),
    );
  }

  return features;
}

type Target = [path: string, expectedText: string];
type Hop = [name: string, a: Target, b: Target];

async function navigate(path: string, expectedText: string) {
  const start = window.performance.now();
  await act(async () => {
    window.history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await screen.findByText(expectedText, {}, { timeout: 120_000 });
  return window.performance.now() - start;
}

async function runNavigation(
  label: string,
  opts: { pages: number; contents: number; nav: boolean },
  hops: Hop[],
) {
  window.history.pushState({}, "", "/catalog");
  const app = createSpecializedApp({
    features: [
      appPlugin,
      catalogPlugin,
      catalogMockModule,
      ...makeNavigationFeatures(opts),
    ],
    config: new ConfigReader({}),
  });
  const resolution = instrumentRouteResolution(app);

  const renderStart = window.performance.now();
  const { unmount } = render(app.element);
  await screen.findAllByText("Catalog", {}, { timeout: 120_000 });
  const firstRender = window.performance.now() - renderStart;

  const parts: string[] = [];
  for (const [name, a, b] of hops) {
    // Visit both targets once so that lazy loading is excluded
    await navigate(...a);
    await navigate(...b);

    const rounds = 5;
    const times: number[] = [];
    resolution.reset();
    for (let i = 0; i < rounds; i++) {
      times.push(await navigate(...a));
      times.push(await navigate(...b));
    }
    const navigations = rounds * 2;
    parts.push(
      `${name}: ${median(times).toFixed(1)}ms (resolve ${(
        resolution.stats.calls / navigations
      ).toFixed(0)} calls, ${(resolution.stats.spent / navigations).toFixed(
        1,
      )}ms)`,
    );
  }

  log(
    `${label} | nodes=${app.tree.nodes.size} firstRender=${firstRender.toFixed(
      0,
    )}ms | ${parts.join(" | ")}`,
  );
  unmount();
}

describeBench("frontend system scale benchmark", () => {
  jest.setTimeout(3_600_000);

  beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("measures app tree creation and route resolution", () => {
    const onePageOrContent = {
      plugins: 200,
      pagesPerPlugin: (i: number) => (i < 100 ? 1 : 0),
      contentsPerPlugin: (i: number) => (i < 100 ? 0 : 1),
    };
    const tenOfEach = {
      plugins: 200,
      pagesPerPlugin: () => 10,
      contentsPerPlugin: () => 10,
    };

    runWiring("warmup", {
      plugins: 1,
      pagesPerPlugin: () => 1,
      contentsPerPlugin: () => 1,
    });
    runWiring("baseline, 1 plugin", {
      plugins: 1,
      pagesPerPlugin: () => 1,
      contentsPerPlugin: () => 1,
    });
    runWiring("100 pages + 100 contents", onePageOrContent);
    runWiring("100 pages + 100 contents, config entries", {
      ...onePageOrContent,
      configEntries: true,
    });
    runWiring("100 pages + 100 contents, 200 modules", {
      ...onePageOrContent,
      modules: true,
    });
    runWiring("200 plugins x (10 pages + 10 contents)", tenOfEach);
    runWiring("200 plugins x (10 pages + 10 contents), config entries", {
      ...tenOfEach,
      configEntries: true,
    });
  });

  describe("route changes", () => {
    const sizes = (process.env.BENCH_SIZES ?? "2,10,50,100,200,400")
      .split(",")
      .map(Number);
    const series = (
      process.env.BENCH_SERIES ?? "pages-nav,pages-nonav,contents,both"
    ).split(",");

    const pageHop: Hop = [
      "page<->page",
      ["/dyn-0", "page-body-0"],
      ["/dyn-1", "page-body-1"],
    ];
    const tabHop: Hop = [
      "tab<->tab",
      ["/catalog/default/component/x/dyn-0", "content-body-0"],
      ["/catalog/default/component/x/dyn-1", "content-body-1"],
    ];
    const hops = [pageHop, tabHop];

    it("warmup", async () => {
      await runNavigation("warmup", { pages: 2, contents: 2, nav: true }, hops);
    });

    for (const n of sizes) {
      if (series.includes("pages-nav")) {
        it(`${n} pages with sidebar items`, async () => {
          await runNavigation(
            `pages(nav)=${n} contents=2`,
            { pages: n, contents: 2, nav: true },
            hops,
          );
        });
      }
      if (series.includes("pages-nonav")) {
        it(`${n} pages without sidebar items`, async () => {
          await runNavigation(
            `pages(no nav)=${n} contents=2`,
            { pages: n, contents: 2, nav: false },
            hops,
          );
        });
      }
      if (series.includes("contents")) {
        it(`${n} entity contents`, async () => {
          await runNavigation(
            `pages(no nav)=2 contents=${n}`,
            { pages: 2, contents: n, nav: false },
            hops,
          );
        });
      }
      if (series.includes("both")) {
        it(`${n} pages and ${n} entity contents`, async () => {
          await runNavigation(
            `pages(nav)=${n} contents=${n}`,
            { pages: n, contents: n, nav: true },
            hops,
          );
        });
      }
    }
  });
});
