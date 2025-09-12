import {
  createTranslationMessages,
  createTranslationResource,
  TranslationRef,
} from '@backstage/core-plugin-api/alpha';

import { translationResourceGenerator } from './translationResourceGenerator';

jest.mock('@backstage/core-plugin-api/alpha');

describe('translationResourceGenerator', () => {
  let mockRef: TranslationRef<string, any>;
  const baseResource = {
    $$type: '' as any,
    id: 'test.translation',
    version: 'v1' as any,
    resources: [
      {
        language: 'en',
        loader: async () => ({
          messages: {
            hello: 'Hello',
            bye: 'Goodbye',
          },
        }),
      },
      {
        language: 'fr',
        loader: async () => ({
          messages: {
            hello: 'Bonjour',
            bye: 'Au revoir',
          },
        }),
      },
    ],
  };

  beforeEach(() => {
    jest.resetAllMocks();
    mockRef = { id: 'test.translation' } as TranslationRef<string, any>;
  });

  it('should merge base translations with JSON overrides', async () => {
    const jsonTranslations = {
      en: {
        bye: 'See ya',
        welcome: 'Welcome',
      },
    };

    (createTranslationMessages as jest.Mock).mockImplementation(
      ({ ref, messages }) => ({ ref, messages }),
    );
    (createTranslationResource as jest.Mock).mockImplementation(
      ({ ref, translations }) => ({ ref, translations }),
    );

    const resource = translationResourceGenerator(
      mockRef,
      baseResource,
      jsonTranslations,
    );

    const enMessages = await (resource as any).translations?.en();
    expect(enMessages.default.messages).toEqual({
      hello: 'Hello',
      bye: 'See ya',
      welcome: 'Welcome',
    });
  });
  it('should create new translation resource for the locale not present in base resource', async () => {
    const jsonTranslations = {
      ko: { hello: 'annyeonghaseyo' },
    };

    (createTranslationMessages as jest.Mock).mockImplementation(
      ({ ref, messages }) => ({ ref, messages }),
    );
    (createTranslationResource as jest.Mock).mockImplementation(
      ({ ref, translations }) => ({ ref, translations }),
    );

    const resource = translationResourceGenerator(
      mockRef,
      baseResource,
      jsonTranslations,
    );
    const translations = await (resource as any).translations;

    expect(Object.keys(translations)).toContain('ko');
  });
});
