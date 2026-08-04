import { collectLoadableFeatures } from './collectLoadableFeatures';

describe('collectLoadableFeatures', () => {
  const plugin = { $$type: '@backstage/FrontendPlugin' as const };
  const moduleFeature = { $$type: '@backstage/FrontendModule' as const };

  it('collects default and named FrontendFeature exports without duplicates', () => {
    const features = collectLoadableFeatures({
      default: plugin,
      globalHeaderPlugin: plugin,
      globalHeaderModule: moduleFeature,
      GlobalHeaderMenuItem: () => null,
    });

    expect(features).toEqual([plugin, moduleFeature]);
  });

  it('returns empty when nothing is loadable', () => {
    expect(
      collectLoadableFeatures({
        default: { createPlugin: true },
        helper: () => null,
      }),
    ).toEqual([]);
  });
});
