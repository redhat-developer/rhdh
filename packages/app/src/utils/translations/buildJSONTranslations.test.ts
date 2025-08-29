import { JSONTranslationConfig } from '../../types/types';
import { buildJSONTranslations } from './buildJSONTranslations';

describe('buildJSONTranslations', () => {
  const baseUrl = 'http://localhost:7007';
  const mockJson = { hello: 'Hello' };

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(mockJson),
    }) as unknown as typeof fetch;

    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should creat loaders for valid configs', async () => {
    const configs: JSONTranslationConfig[] = [
      { locale: 'en', path: '/mock/en.json' },
    ];

    const loaders = buildJSONTranslations(configs, baseUrl);

    expect(Object.keys(loaders)).toEqual(['en']);

    const result = await loaders?.en();
    expect(result).toEqual(mockJson);

    expect(fetch).toHaveBeenCalledWith(
      `${baseUrl}/api/translation?path=/mock/en.json`,
    );
  });

  it('should skip config with missing path and log a warning', () => {
    const configs: JSONTranslationConfig[] = [{ locale: 'en', path: '' }];

    const loaders = buildJSONTranslations(configs, baseUrl);

    expect(loaders).toEqual({});
    // eslint-disable-next-line no-console
    expect(console.warn).toHaveBeenCalledWith(
      'No translation file provided for en',
    );
  });

  it('should skip config with missing locale and log a warning', () => {
    const configs: JSONTranslationConfig[] = [
      { locale: '', path: '/mock/en.json' },
    ];

    const loaders = buildJSONTranslations(configs, baseUrl);

    expect(loaders).toEqual({});
    // eslint-disable-next-line no-console
    expect(console.warn).toHaveBeenCalledWith(
      'No locale specified for translation file /mock/en.json',
    );
  });

  it('should log a warning if api call fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      json: jest.fn().mockResolvedValue({}),
    });

    const configs: JSONTranslationConfig[] = [
      { locale: 'en', path: '/mock/en.json' },
    ];

    const loaders = buildJSONTranslations(configs, baseUrl);
    await loaders?.en();
    // eslint-disable-next-line no-console
    expect(console.warn).toHaveBeenCalledWith(
      'Failed to load translation file for en at /mock/en.json',
    );
  });
});
