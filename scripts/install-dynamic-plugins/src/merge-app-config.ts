/**
 * Merges pluginConfig fragment into global config (same rules as the installer's merge()).
 */
export function mergeAppConfigFragments(
  source: Record<string, unknown>,
  destination: Record<string, unknown>,
  prefix = ''
): Record<string, unknown> {
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const node =
        destination[key] !== undefined
          ? (destination[key] as Record<string, unknown>)
          : ((destination[key] = {}) as Record<string, unknown>);
      mergeAppConfigFragments(
        value as Record<string, unknown>,
        node,
        `${prefix}${key}.`
      );
    } else {
      if (key in destination && destination[key] !== value) {
        throw new Error(
          `Config key '${prefix + key}' defined differently for 2 dynamic plugins`
        );
      }
      destination[key] = value;
    }
  }
  return destination;
}
