import { TranslationConfig } from '../../types/types';
import { getDefaultLanguage } from './language';

// Mock navigator for testing
const mockNavigator = {
  languages: ['en-US', 'en', 'fr-FR'],
  language: 'en-US',
};

// Mock the global navigator
Object.defineProperty(global, 'navigator', {
  value: mockNavigator,
  writable: true,
});

describe('getDefaultLanguage', () => {
  beforeEach(() => {
    // Reset navigator mock before each test
    Object.defineProperty(global, 'navigator', {
      value: mockNavigator,
      writable: true,
    });
  });

  describe('Priority 1: browser language matching', () => {
    it('should use browser language when it matches available locales exactly', () => {
      const translationConfig: TranslationConfig = {
        locales: ['en', 'fr', 'de'],
        // No defaultLocale set
      };

      // Mock navigator to have 'fr' as first language
      Object.defineProperty(global, 'navigator', {
        value: {
          languages: ['fr', 'en', 'de'],
          language: 'fr',
        },
        writable: true,
      });

      const result = getDefaultLanguage(translationConfig);
      expect(result).toBe('fr');
    });

    it('should use base language when browser has region-specific language', () => {
      const translationConfig: TranslationConfig = {
        locales: ['en', 'fr', 'de'],
        // No defaultLocale set
      };

      // Mock navigator to have 'fr-FR' as first language
      Object.defineProperty(global, 'navigator', {
        value: {
          languages: ['fr-FR', 'en-US', 'de-DE'],
          language: 'fr-FR',
        },
        writable: true,
      });

      const result = getDefaultLanguage(translationConfig);
      expect(result).toBe('fr');
    });

    it('should prioritize browser language over defaultLocale configuration', () => {
      const translationConfig: TranslationConfig = {
        locales: ['en', 'fr', 'de'],
        defaultLocale: 'de', // This should be ignored when browser language matches
      };

      // Mock navigator to have 'fr' as first language
      Object.defineProperty(global, 'navigator', {
        value: {
          languages: ['fr', 'en', 'de'],
          language: 'fr',
        },
        writable: true,
      });

      const result = getDefaultLanguage(translationConfig);
      expect(result).toBe('fr'); // Should use browser language, not defaultLocale
    });

    it('should handle multiple region-specific languages', () => {
      const translationConfig: TranslationConfig = {
        locales: ['en', 'fr', 'de', 'es'],
        // No defaultLocale set
      };

      // Mock navigator to have multiple region-specific languages
      Object.defineProperty(global, 'navigator', {
        value: {
          languages: ['es-ES', 'fr-FR', 'en-US', 'de-DE'],
          language: 'es-ES',
        },
        writable: true,
      });

      const result = getDefaultLanguage(translationConfig);
      expect(result).toBe('es');
    });

    it('should fallback to second browser language when first is not supported', () => {
      const translationConfig: TranslationConfig = {
        locales: ['en', 'de'],
        // No defaultLocale set
      };

      // Mock navigator to have 'fr' as first language (not supported) and 'de' as second
      Object.defineProperty(global, 'navigator', {
        value: {
          languages: ['fr', 'de', 'en'],
          language: 'fr',
        },
        writable: true,
      });

      const result = getDefaultLanguage(translationConfig);
      expect(result).toBe('de');
    });

    it('should use base language from second browser language when first is not supported', () => {
      const translationConfig: TranslationConfig = {
        locales: ['en', 'de'],
        // No defaultLocale set
      };

      // Mock navigator to have 'fr' as first language (not supported) and 'de-DE' as second
      Object.defineProperty(global, 'navigator', {
        value: {
          languages: ['fr', 'de-DE', 'en-US'],
          language: 'fr',
        },
        writable: true,
      });

      const result = getDefaultLanguage(translationConfig);
      expect(result).toBe('de');
    });

    it('should prioritize exact matches over base language matches', () => {
      const translationConfig: TranslationConfig = {
        locales: ['en', 'en-US', 'fr', 'fr-FR'],
        // No defaultLocale set
      };

      // Mock navigator to have both exact and base language matches
      Object.defineProperty(global, 'navigator', {
        value: {
          languages: ['fr', 'en-US', 'de'],
          language: 'fr',
        },
        writable: true,
      });

      const result = getDefaultLanguage(translationConfig);
      // Should use 'fr' (exact match) instead of 'en' (base language match)
      expect(result).toBe('fr');
    });

    it('should handle mixed exact and base language matches in browser languages', () => {
      const translationConfig: TranslationConfig = {
        locales: ['en', 'fr', 'de'],
        // No defaultLocale set
      };

      // Mock navigator to have mixed exact and base language matches
      Object.defineProperty(global, 'navigator', {
        value: {
          languages: ['fr-FR', 'en', 'de-DE'],
          language: 'fr-FR',
        },
        writable: true,
      });

      const result = getDefaultLanguage(translationConfig);
      expect(result).toBe('fr'); // Should use base language from 'fr-FR'
    });
  });

  describe('Priority 2: translationConfig.defaultLocale fallback', () => {
    it('should use defaultLocale when browser language does not match available locales', () => {
      const translationConfig: TranslationConfig = {
        locales: ['en', 'fr', 'de'],
        defaultLocale: 'fr',
      };

      // Mock navigator to have unsupported languages
      Object.defineProperty(global, 'navigator', {
        value: {
          languages: ['es', 'it', 'pt'],
          language: 'es',
        },
        writable: true,
      });

      const result = getDefaultLanguage(translationConfig);
      expect(result).toBe('fr'); // Should use defaultLocale as fallback
    });

    it('should use defaultLocale when browser language is not supported', () => {
      const translationConfig: TranslationConfig = {
        locales: ['en', 'fr', 'de'],
        defaultLocale: 'de',
      };

      // Mock navigator to have unsupported languages
      Object.defineProperty(global, 'navigator', {
        value: {
          languages: ['ja', 'ko', 'zh'],
          language: 'ja',
        },
        writable: true,
      });

      const result = getDefaultLanguage(translationConfig);
      expect(result).toBe('de'); // Should use defaultLocale as fallback
    });

    it('should prioritize browser language over defaultLocale when both are available', () => {
      const translationConfig: TranslationConfig = {
        locales: ['en', 'fr', 'de'],
        defaultLocale: 'de',
      };

      // Mock navigator to have supported language
      Object.defineProperty(global, 'navigator', {
        value: {
          languages: ['fr', 'en', 'de'],
          language: 'fr',
        },
        writable: true,
      });

      const result = getDefaultLanguage(translationConfig);
      expect(result).toBe('fr'); // Should use browser language, not defaultLocale
    });
  });

  describe('Priority 3: fallback to "en"', () => {
    it('should default to "en" when no browser language is supported and no defaultLocale is configured', () => {
      const translationConfig: TranslationConfig = {
        locales: ['en', 'de'],
        // No defaultLocale set
      };

      // Mock navigator to have only unsupported languages
      Object.defineProperty(global, 'navigator', {
        value: {
          languages: ['fr', 'es', 'it'],
          language: 'fr',
        },
        writable: true,
      });

      const result = getDefaultLanguage(translationConfig);
      expect(result).toBe('en');
    });

    it('should default to "en" when translationConfig is undefined', () => {
      const result = getDefaultLanguage(undefined);
      expect(result).toBe('en');
    });

    it('should default to "en" when translationConfig.locales is empty', () => {
      const translationConfig: TranslationConfig = {
        locales: [],
        // No defaultLocale set
      };

      const result = getDefaultLanguage(translationConfig);
      expect(result).toBe('en');
    });

    it('should default to "en" when translationConfig.locales only contains unsupported languages', () => {
      const translationConfig: TranslationConfig = {
        locales: ['fr', 'de'],
        // No defaultLocale set
      };

      // Mock navigator to have only unsupported languages
      Object.defineProperty(global, 'navigator', {
        value: {
          languages: ['es', 'it', 'pt'],
          language: 'es',
        },
        writable: true,
      });

      const result = getDefaultLanguage(translationConfig);
      expect(result).toBe('en');
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle navigator.languages being undefined', () => {
      const translationConfig: TranslationConfig = {
        locales: ['en', 'fr'],
        // No defaultLocale set
      };

      // Mock navigator to have undefined languages
      Object.defineProperty(global, 'navigator', {
        value: {
          languages: undefined,
          language: 'fr',
        },
        writable: true,
      });

      const result = getDefaultLanguage(translationConfig);
      expect(result).toBe('fr');
    });

    it('should handle navigator.language being undefined', () => {
      const translationConfig: TranslationConfig = {
        locales: ['en', 'fr'],
        // No defaultLocale set
      };

      // Mock navigator to have undefined language
      Object.defineProperty(global, 'navigator', {
        value: {
          languages: ['fr', 'en'],
          language: undefined,
        },
        writable: true,
      });

      const result = getDefaultLanguage(translationConfig);
      expect(result).toBe('fr');
    });

    it('should handle both navigator.languages and navigator.language being undefined', () => {
      const translationConfig: TranslationConfig = {
        locales: ['en', 'fr'],
        // No defaultLocale set
      };

      // Mock navigator to have undefined languages and language
      Object.defineProperty(global, 'navigator', {
        value: {
          languages: undefined,
          language: undefined,
        },
        writable: true,
      });

      const result = getDefaultLanguage(translationConfig);
      expect(result).toBe('en');
    });

    it('should handle empty browser languages array', () => {
      const translationConfig: TranslationConfig = {
        locales: ['en', 'fr'],
        // No defaultLocale set
      };

      // Mock navigator to have empty languages array
      Object.defineProperty(global, 'navigator', {
        value: {
          languages: [],
          language: 'fr',
        },
        writable: true,
      });

      const result = getDefaultLanguage(translationConfig);
      expect(result).toBe('fr');
    });

    it('should handle browser languages with empty strings', () => {
      const translationConfig: TranslationConfig = {
        locales: ['en', 'fr'],
        // No defaultLocale set
      };

      // Mock navigator to have empty strings in languages array
      Object.defineProperty(global, 'navigator', {
        value: {
          languages: ['', 'fr', 'en'],
          language: '',
        },
        writable: true,
      });

      const result = getDefaultLanguage(translationConfig);
      expect(result).toBe('fr'); // Should skip empty string and use 'fr'
    });

    it('should handle browser languages with null/undefined values', () => {
      const translationConfig: TranslationConfig = {
        locales: ['en', 'fr'],
        // No defaultLocale set
      };

      // Mock navigator to have null/undefined values in languages array
      Object.defineProperty(global, 'navigator', {
        value: {
          languages: [null, undefined, 'fr', 'en'],
          language: null,
        },
        writable: true,
      });

      const result = getDefaultLanguage(translationConfig);
      expect(result).toBe('fr'); // Should skip null/undefined and use 'fr'
    });

    it('should handle language codes with multiple hyphens', () => {
      const translationConfig: TranslationConfig = {
        locales: ['en', 'zh', 'zh-CN'],
        // No defaultLocale set
      };

      // Mock navigator to have language codes with multiple hyphens
      Object.defineProperty(global, 'navigator', {
        value: {
          languages: ['zh-CN-Hans', 'en-US'],
          language: 'zh-CN-Hans',
        },
        writable: true,
      });

      const result = getDefaultLanguage(translationConfig);
      expect(result).toBe('zh'); // Should extract 'zh' from 'zh-CN-Hans'
    });

    it('should handle single-character language codes', () => {
      const translationConfig: TranslationConfig = {
        locales: ['en', 'a', 'b'],
        // No defaultLocale set
      };

      // Mock navigator to have single-character language codes
      Object.defineProperty(global, 'navigator', {
        value: {
          languages: ['a', 'b', 'en'],
          language: 'a',
        },
        writable: true,
      });

      const result = getDefaultLanguage(translationConfig);
      expect(result).toBe('a');
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle common browser language combinations', () => {
      const translationConfig: TranslationConfig = {
        locales: ['en', 'fr', 'de', 'es'],
        // No defaultLocale set
      };

      // Common browser language combination: English (US), English, French (Canada)
      Object.defineProperty(global, 'navigator', {
        value: {
          languages: ['en-US', 'en', 'fr-CA'],
          language: 'en-US',
        },
        writable: true,
      });

      const result = getDefaultLanguage(translationConfig);
      expect(result).toBe('en'); // Should use base language from 'en-US'
    });

    it('should handle European browser language preferences', () => {
      const translationConfig: TranslationConfig = {
        locales: ['en', 'de', 'fr', 'it'],
        // No defaultLocale set
      };

      // European browser language preference: German (Germany), English (US), French (France)
      Object.defineProperty(global, 'navigator', {
        value: {
          languages: ['de-DE', 'en-US', 'fr-FR'],
          language: 'de-DE',
        },
        writable: true,
      });

      const result = getDefaultLanguage(translationConfig);
      expect(result).toBe('de'); // Should use base language from 'de-DE'
    });

    it('should handle Asian browser language preferences', () => {
      const translationConfig: TranslationConfig = {
        locales: ['en', 'zh', 'ja', 'ko'],
        // No defaultLocale set
      };

      // Asian browser language preference: Chinese (Simplified), English (US)
      Object.defineProperty(global, 'navigator', {
        value: {
          languages: ['zh-CN', 'en-US'],
          language: 'zh-CN',
        },
        writable: true,
      });

      const result = getDefaultLanguage(translationConfig);
      expect(result).toBe('zh'); // Should use base language from 'zh-CN'
    });
  });
});
