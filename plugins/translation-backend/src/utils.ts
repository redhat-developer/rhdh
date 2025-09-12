export function isValidJSONTranslation(json: Record<string, any>): boolean {
  if (typeof json !== 'object' || json === null) return false;

  for (const [pluginRef, locales] of Object.entries(json)) {
    if (typeof pluginRef !== 'string') return false;
    if (typeof locales !== 'object' || locales === null) return false;

    for (const [locale, messages] of Object.entries(locales)) {
      if (typeof locale !== 'string') return false;
      if (typeof messages !== 'object' || messages === null) return false;

      for (const [k, v] of Object.entries(messages)) {
        if (typeof k !== 'string' || typeof v !== 'string') {
          return false;
        }
      }
    }
  }

  return true;
}

export function deepMergeTranslations(
  target: Record<string, any>,
  source: Record<string, any>,
): Record<string, any> {
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key])
    ) {
      target[key] = deepMergeTranslations(target[key] || {}, source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

export function filterLocales(
  allTranslations: Record<string, any>,
  configuredLocales: string[],
): Record<string, any> {
  const filtered: Record<string, any> = {};
  for (const pluginId of Object.keys(allTranslations)) {
    for (const locale of configuredLocales) {
      if (allTranslations[pluginId][locale]) {
        filtered[pluginId] = {
          ...(filtered[pluginId] ?? {}),
          [locale]: allTranslations[pluginId][locale],
        };
      }
    }
  }

  return filtered;
}
