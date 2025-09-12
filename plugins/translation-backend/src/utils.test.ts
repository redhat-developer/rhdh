import {
  deepMergeTranslations,
  filterLocales,
  isValidJSONTranslation,
} from './utils';

describe('isValidJSONTranslation', () => {
  it('should return true for a valid JSON translation object', () => {
    const validJson = {
      'plugin.npm.translation-ref': {
        en: {
          'infoCard.title': 'NPM Packet JSON {{packageName}}',
        },
        de: {
          'infoCard.title': 'NPM Pakettt JSON {{packageName}}',
        },
        zh: {
          'infoCard.title': 'NPM 包 JSON {{packageName}}',
        },
      },
    };

    expect(isValidJSONTranslation(validJson)).toBe(true);
  });

  it('should return false for invalid JSON translation object', () => {
    expect(isValidJSONTranslation(null as any)).toBe(false);
    expect(isValidJSONTranslation('string' as any)).toBe(false);
    expect(isValidJSONTranslation(42 as any)).toBe(false);
    const invalidJson = {
      'plugin.npm.translation-ref': 'not-an-object',
    };
    expect(isValidJSONTranslation(invalidJson)).toBe(false);
    const invalidJson2 = {
      'plugin.npm.translation-ref': {
        en: 'not-an-object',
      },
    };
    expect(isValidJSONTranslation(invalidJson2)).toBe(false);
  });
});

describe('deepMergeTranslations', () => {
  it('should merge translations', () => {
    const target = {
      'plugin.npm.translation-ref': {
        en: { 'infoCard.title': 'NPM Packet JSON {{packageName}}' },
        de: { 'infoCard.title': 'NPM Pakettt JSON {{packageName}}' },
      },
    };
    const source = {
      'plugin.npm.translation-ref': {
        fr: { 'infoCard.title': 'NPM Paquet JSON {{packageName}}' },
        en: { 'infoCard.description': 'Description for {{packageName}}' },
      },
    };

    const result = deepMergeTranslations({ ...target }, source);

    expect(result).toEqual({
      'plugin.npm.translation-ref': {
        en: {
          'infoCard.title': 'NPM Packet JSON {{packageName}}',
          'infoCard.description': 'Description for {{packageName}}',
        },
        de: {
          'infoCard.title': 'NPM Pakettt JSON {{packageName}}',
        },
        fr: {
          'infoCard.title': 'NPM Paquet JSON {{packageName}}',
        },
      },
    });
  });

  it('should handle empty source', () => {
    const target = { hello: 'world' };
    const source = {};

    const result = deepMergeTranslations({ ...target }, source);

    expect(result).toEqual({ hello: 'world' });
  });

  it('should handle empty target', () => {
    const target = {};
    const source = { hello: 'world' };

    const result = deepMergeTranslations({ ...target }, source);

    expect(result).toEqual({ hello: 'world' });
  });
});

describe('filterLocales', () => {
  const translations = {
    pluginA: {
      en: { hello: 'world' },
      de: { hello: 'welt' },
      fr: { hello: 'monde' },
    },
    pluginB: {
      en: { bye: 'goodbye' },
      es: { bye: 'adiós' },
    },
  };

  it('should return override translations for only the configured locales', () => {
    const result = filterLocales(translations, ['en', 'de']);
    expect(result).toEqual({
      pluginA: {
        en: { hello: 'world' },
        de: { hello: 'welt' },
      },
      pluginB: {
        en: { bye: 'goodbye' },
      },
    });
  });

  it('should return empty object if no locales match', () => {
    const result = filterLocales(translations, ['it', 'jp']);
    expect(result).toEqual({});
  });

  it('should handle empty translations input', () => {
    const result = filterLocales({}, ['en', 'de']);
    expect(result).toEqual({});
  });

  it('should ignore plugins that have no matching locales', () => {
    const input = {
      pluginC: {
        fr: { greeting: 'bonjour' },
      },
    };
    const result = filterLocales(input, ['en']);
    expect(result).toEqual({});
  });
});
