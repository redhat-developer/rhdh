import { JSONTranslationConfig } from '../../types/types';

type JSONLoader = () => Promise<Record<string, string>>;

export const buildJSONTranslations = (
  configs: JSONTranslationConfig[],
  baseUrl: string,
): Record<string, JSONLoader> => {
  const loaders: Record<string, JSONLoader> = {};

  for (const { locale, path } of configs) {
    if (!locale || !path) {
      if (!path) {
        // eslint-disable-next-line no-console
        console.warn(`No translation file provided for ${locale}`);
      } else {
        // eslint-disable-next-line no-console
        console.warn(`No locale specified for translation file ${path}`);
      }
      continue;
    }
    loaders[locale] = async () => {
      try {
        const res = await fetch(`${baseUrl}/api/translation?path=${path}`);
        if (!res.ok) {
          // eslint-disable-next-line no-console
          console.warn(
            `Failed to load translation file for ${locale} at ${path}`,
          );
        }
        return res.json();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(err);
        return null;
      }
    };
  }

  return loaders;
};
