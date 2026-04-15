// Reference implementation of install-dynamic-plugins.merge() with
// replace-semantics for Backstage scheduler duration subtrees
// (schedule.frequency, schedule.timeout, schedule.initialDelay).
//
// The generic deep-merge used elsewhere combines sibling keys, which silently
// turns a default `frequency: { minutes: 60 }` and a user-provided
// `frequency: { seconds: 30 }` into `{ minutes: 60, seconds: 30 }` (ISO-8601
// PT60M30S). For duration dicts, whatever the most-recent source provides
// replaces the destination entirely — the user's value is absolute.
//
// This TypeScript version is intended to stay in sync with the Python
// implementation in scripts/install-dynamic-plugins/install-dynamic-plugins.py
// and to serve as the reference once that script is migrated to TS/Node.

type PluginConfig = Record<string, unknown>;

const DURATION_SUBTREE_PATHS: readonly string[] = [
  "schedule.frequency",
  "schedule.timeout",
  "schedule.initialDelay",
];

function pathEndsWithDurationSubtree(fullPath: string): boolean {
  return DURATION_SUBTREE_PATHS.some(
    (tail) => fullPath === tail || fullPath.endsWith(`.${tail}`),
  );
}

function isPlainObject(value: unknown): value is PluginConfig {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function mergePluginConfig(
  source: PluginConfig,
  destination: PluginConfig,
  prefix = "",
): PluginConfig {
  for (const [key, value] of Object.entries(source)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;

    if (isPlainObject(value)) {
      if (pathEndsWithDurationSubtree(fullPath)) {
        destination[key] = { ...value };
        continue;
      }
      const existing = destination[key];
      const node: PluginConfig = isPlainObject(existing) ? existing : {};
      destination[key] = node;
      mergePluginConfig(value, node, fullPath);
    } else {
      if (key in destination && destination[key] !== value) {
        throw new Error(
          `Config key '${fullPath}' defined differently for 2 dynamic plugins`,
        );
      }
      destination[key] = value;
    }
  }
  return destination;
}
