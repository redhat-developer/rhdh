import type { FrontendFeature } from '@backstage/frontend-plugin-api';

function isLoadable(obj: unknown): obj is FrontendFeature {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    '$$type' in obj &&
    ((obj as { $$type: string }).$$type === '@backstage/FrontendPlugin' ||
      (obj as { $$type: string }).$$type === '@backstage/FrontendModule')
  );
}

/**
 * Collect default and named `FrontendPlugin` / `FrontendModule` exports from a
 * module-federation remote namespace (deduped by reference).
 */
export function collectLoadableFeatures(
  moduleNamespace: Record<string, unknown>,
): FrontendFeature[] {
  const seen = new Set<object>();
  const features: FrontendFeature[] = [];
  for (const value of Object.values(moduleNamespace)) {
    if (isLoadable(value) && !seen.has(value)) {
      seen.add(value);
      features.push(value);
    }
  }
  return features;
}
