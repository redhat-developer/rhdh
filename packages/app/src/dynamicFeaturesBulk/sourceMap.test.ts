import {
  clearBulkSourceMap,
  indexBulkSources,
  lookupBulkSource,
  markBulkExecuted,
  wasBulkExecuted,
} from "./sourceMap";
import { createBulkRemoteEntriesMfPlugin } from "./mfPlugin";
import {
  evalClassicRemoteEntry,
  resetBulkApplyForTests,
  applyBulkRemoteEntries,
} from "./applyBulk";

describe("bulk source map + MF plugin", () => {
  beforeEach(() => {
    clearBulkSourceMap();
    resetBulkApplyForTests();
    delete window.__DYNAMIC_FEATURES_BULK__;
  });

  it("indexes absolute URL and pathname for lookup", () => {
    const url =
      "http://localhost:7007/.backstage/dynamic-features/remotes/p/remoteEntry.js";
    indexBulkSources({ [url]: "window.__bulk_test__ = 1;" });

    expect(lookupBulkSource(url)).toContain("__bulk_test__");
    expect(
      lookupBulkSource("/.backstage/dynamic-features/remotes/p/remoteEntry.js"),
    ).toContain("__bulk_test__");
  });

  it("evalClassicRemoteEntry registers globals", () => {
    evalClassicRemoteEntry("window.__bulk_eval_ok__ = 42;");
    expect(
      (window as unknown as { __bulk_eval_ok__: number }).__bulk_eval_ok__,
    ).toBe(42);
    delete (window as unknown as { __bulk_eval_ok__?: number })
      .__bulk_eval_ok__;
  });

  it("evalClassicRemoteEntry fakes document.currentScript from entryUrl", () => {
    const entryUrl =
      "http://localhost:7007/.backstage/dynamic-features/remotes/p/remoteEntry.js";
    evalClassicRemoteEntry(
      "window.__bulk_cs__ = document.currentScript && document.currentScript.src;",
      entryUrl,
    );
    expect((window as unknown as { __bulk_cs__?: string }).__bulk_cs__).toBe(
      entryUrl,
    );
    delete (window as unknown as { __bulk_cs__?: string }).__bulk_cs__;
    // Getter restored after eval
    expect(document.currentScript).toBeNull();
  });

  it("createScript evals mapped source then returns a no-op data: script", () => {
    const url = "http://localhost:7007/remotes/p/remoteEntry.js";
    indexBulkSources({
      [url]:
        "window.__bulk_cs_plugin__ = document.currentScript && document.currentScript.src;",
    });
    const plugin = createBulkRemoteEntriesMfPlugin();
    const result = plugin.createScript?.({ url });
    expect(result).toBeInstanceOf(HTMLScriptElement);
    const script = result as HTMLScriptElement;
    expect(script.src).toMatch(/^data:text\/javascript/);
    expect(wasBulkExecuted(url)).toBe(true);
    expect(
      (window as unknown as { __bulk_cs_plugin__?: string }).__bulk_cs_plugin__,
    ).toBe(url);

    // Second call: no-op only (idempotent)
    const again = plugin.createScript?.({ url }) as HTMLScriptElement;
    expect(again.src).toMatch(/^data:text\/javascript/);

    delete (window as unknown as { __bulk_cs_plugin__?: string })
      .__bulk_cs_plugin__;
  });

  it("fetch hook serves mapped sources without network", async () => {
    const url = "http://localhost:7007/remotes/p/static/1.js";
    indexBulkSources({ [url]: "window.chunk = 1;" });
    const plugin = createBulkRemoteEntriesMfPlugin();
    const res = await plugin.fetch?.(url, {});
    expect(res).toBeInstanceOf(Response);
    expect(await (res as Response).text()).toBe("window.chunk = 1;");
  });

  it("applyBulkRemoteEntries no-ops when bulk meta disabled", async () => {
    window.__DYNAMIC_FEATURES_BULK__ = { enabled: false };
    const fetchSpy = jest.spyOn(global, "fetch");
    await applyBulkRemoteEntries("http://localhost:7007");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("applyBulkRemoteEntries fetches, indexes, and evaluates", async () => {
    window.__DYNAMIC_FEATURES_BULK__ = {
      enabled: true,
      url: "/.backstage/dynamic-features-preload/bulk.json",
    };
    const entryUrl = "http://localhost:7007/remotes/p/remoteEntry.js";
    jest.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          version: 1,
          sources: {
            [entryUrl]: "window.__bulk_applied__ = true;",
          },
          evaluate: [entryUrl],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await applyBulkRemoteEntries("http://localhost:7007");
    expect(
      (window as unknown as { __bulk_applied__?: boolean }).__bulk_applied__,
    ).toBe(true);
    expect(lookupBulkSource(entryUrl)).toContain("__bulk_applied__");
    markBulkExecuted(entryUrl);

    delete (window as unknown as { __bulk_applied__?: boolean })
      .__bulk_applied__;
    (global.fetch as jest.Mock).mockRestore();
  });
});
