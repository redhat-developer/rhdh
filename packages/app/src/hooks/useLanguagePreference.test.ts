import { useAsync } from 'react-use';
import useObservable from 'react-use/esm/useObservable';

import {
  configApiRef,
  identityApiRef,
  storageApiRef,
  useApi,
} from '@backstage/core-plugin-api';
import { appLanguageApiRef } from '@backstage/core-plugin-api/alpha';

import { renderHook, waitFor } from '@testing-library/react';

import { useLanguagePreference } from './useLanguagePreference';

const mockLanguageApi = {
  language$: jest.fn(),
  getLanguage: jest.fn(),
  setLanguage: jest.fn(),
};
const mockStorageApi = {
  forBucket: jest.fn(() => ({
    snapshot: jest.fn(),
    observe$: jest.fn(),
    set: jest.fn(),
  })),
};
const mockIdentityApi = {
  getBackstageIdentity: jest.fn(),
};
const mockConfigApi = {
  getOptionalString: jest.fn(),
  getOptionalConfig: jest.fn(),
};

// Mock hooks
jest.mock('@backstage/core-plugin-api', () => ({
  useApi: jest.fn(),
  configApiRef: { id: 'config' },
  identityApiRef: { id: 'identity' },
  storageApiRef: { id: 'storage' },
}));

jest.mock('@backstage/core-plugin-api/alpha', () => ({
  appLanguageApiRef: { id: 'appLanguage' },
}));

jest.mock('react-use', () => ({
  useAsync: jest.fn(),
}));

jest.mock('react-use/esm/useObservable', () => ({
  __esModule: true,
  default: jest.fn(),
}));

describe('useLanguagePreference', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (useApi as jest.Mock).mockImplementation((ref: any) => {
      if (ref === appLanguageApiRef) return mockLanguageApi;
      if (ref === storageApiRef) return mockStorageApi;
      if (ref === identityApiRef) return mockIdentityApi;
      if (ref === configApiRef) return mockConfigApi;
      return undefined;
    });

    // default mocks
    (useAsync as jest.Mock).mockReturnValue({
      value: { userEntityRef: 'user:default/test' },
      loading: false,
    });
    (useObservable as jest.Mock).mockReturnValue({ language: 'en' });

    mockLanguageApi.getLanguage.mockReturnValue({
      language: 'en',
    });
    mockConfigApi.getOptionalString.mockImplementation((key: string) => {
      if (key === 'userSettings.persistence') return 'database';
      return undefined;
    });
    mockConfigApi.getOptionalConfig.mockImplementation((key: string) => {
      if (key === 'i18n') {
        return {
          getStringArray: jest.fn(() => ['en']),
          getOptional: jest.fn(() => undefined),
        };
      }
      return undefined;
    });
    (mockStorageApi.forBucket as jest.Mock).mockImplementation(() => ({
      snapshot: jest.fn(() => ({ value: 'en' })),
      observe$: jest.fn(() => ({
        subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })),
      })),
      set: jest.fn().mockResolvedValue(undefined),
    }));
  });

  it('should return current language', () => {
    const { result } = renderHook(() => useLanguagePreference());
    expect(result.current).toBe('en');
  });

  it('should not sync if user is guest', () => {
    (useAsync as jest.Mock).mockReturnValue({
      value: { userEntityRef: 'user:development/guest' },
      loading: false,
    });

    renderHook(() => useLanguagePreference());

    expect(mockStorageApi.forBucket().observe$).not.toHaveBeenCalled();
    expect(mockStorageApi.forBucket().set).not.toHaveBeenCalled();
  });

  it('should not sync if still loading identity', () => {
    (useAsync as jest.Mock).mockReturnValue({
      value: undefined,
      loading: true,
    });

    renderHook(() => useLanguagePreference());

    expect(mockStorageApi.forBucket().observe$).not.toHaveBeenCalled();
    expect(mockStorageApi.forBucket().set).not.toHaveBeenCalled();
  });

  it('should not sync when persistence is set to browser', () => {
    mockConfigApi.getOptionalString.mockImplementation((key: string) => {
      if (key === 'userSettings.persistence') return 'browser';
      return undefined;
    });

    renderHook(() => useLanguagePreference());

    expect(mockStorageApi.forBucket().observe$).not.toHaveBeenCalled();
    expect(mockStorageApi.forBucket().set).not.toHaveBeenCalled();
  });

  it('should warn on invalid persistence configuration', () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

    mockConfigApi.getOptionalString.mockImplementation((key: string) => {
      if (key === 'userSettings.persistence') return 'invalid-value';
      return undefined;
    });

    renderHook(() => useLanguagePreference());

    expect(consoleSpy).toHaveBeenCalledWith(
      'useLanguagePreference: Invalid userSettings.persistence value: "invalid-value". Expected "database" or "browser". Defaulting to database.',
    );

    consoleSpy.mockRestore();
  });

  it('should sync when persistence is explicitly set to database', () => {
    const observeMock = jest.fn(() => ({
      subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })),
    }));

    mockConfigApi.getOptionalString.mockImplementation((key: string) => {
      if (key === 'userSettings.persistence') return 'database';
      return undefined;
    });

    (mockStorageApi.forBucket as jest.Mock).mockImplementation(() => ({
      snapshot: jest.fn(() => ({ value: 'en' })),
      observe$: observeMock,
      set: jest.fn(),
    }));

    renderHook(() => useLanguagePreference());

    expect(observeMock).toHaveBeenCalled();
  });

  it('should not sync on first hydration after refresh', () => {
    (useObservable as jest.Mock).mockReturnValue({ language: 'fr' });

    renderHook(() => useLanguagePreference());

    // Should not sync on first render due to hydration guard
    expect(mockStorageApi.forBucket().set).not.toHaveBeenCalled();
  });

  it('should sync after hydration on subsequent language changes', async () => {
    const setFn = jest.fn().mockResolvedValue(undefined);
    (mockStorageApi.forBucket as jest.Mock).mockImplementation(() => ({
      snapshot: jest.fn(() => ({ value: 'en' })),
      observe$: jest.fn(() => ({
        subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })),
      })),
      set: setFn,
    }));

    // Use rerender to test hydration within the same hook instance
    const { rerender } = renderHook(
      ({ lang }) => {
        (useObservable as jest.Mock).mockReturnValue({ language: lang });
        return useLanguagePreference();
      },
      { initialProps: { lang: 'fr' } },
    );

    // Should not sync on first render due to hydration guard
    expect(setFn).not.toHaveBeenCalled();

    // Clear and test second render - should sync after hydration
    setFn.mockClear();
    rerender({ lang: 'de' });

    await waitFor(
      () => {
        expect(setFn).toHaveBeenCalledWith('language', 'de');
      },
      { timeout: 2000 },
    );
  });

  it('should not sync if language value is undefined', () => {
    (useObservable as jest.Mock).mockReturnValue({ language: undefined });

    renderHook(() => useLanguagePreference());

    expect(mockStorageApi.forBucket().set).not.toHaveBeenCalled();
  });

  it('should handle storage set errors gracefully', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
    const setFn = jest.fn().mockRejectedValue(new Error('Storage error'));

    (mockStorageApi.forBucket as jest.Mock).mockImplementation(() => ({
      snapshot: jest.fn(() => ({ value: 'en' })),
      observe$: jest.fn(() => ({
        subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })),
      })),
      set: setFn,
    }));

    const { rerender } = renderHook(
      ({ lang }) => {
        (useObservable as jest.Mock).mockReturnValue({ language: lang });
        return useLanguagePreference();
      },
      { initialProps: { lang: 'fr' } },
    );

    // Trigger sync after hydration
    rerender({ lang: 'de' });

    await waitFor(
      () => {
        expect(consoleSpy).toHaveBeenCalledWith(
          'useLanguagePreference: Failed to store language in user-settings storage',
          expect.any(Error),
        );
      },
      { timeout: 2000 },
    );

    consoleSpy.mockRestore();
  });

  it('should unsubscribe from storage observable on unmount', () => {
    const unsubscribeFn = jest.fn();
    (mockStorageApi.forBucket as jest.Mock).mockImplementation(() => ({
      snapshot: jest.fn(() => ({ value: 'en' })),
      observe$: jest.fn(() => ({
        subscribe: jest.fn(() => ({ unsubscribe: unsubscribeFn })),
      })),
      set: jest.fn(),
    }));

    const { unmount } = renderHook(() => useLanguagePreference());

    unmount();

    expect(unsubscribeFn).toHaveBeenCalled();
  });

  it('should not call setLanguage if stored value equals current language', () => {
    (mockStorageApi.forBucket as jest.Mock).mockImplementation(() => ({
      snapshot: jest.fn(() => ({ value: 'en' })),
      observe$: jest.fn(() => ({
        subscribe: (cb: any) => {
          cb({ value: 'en' }); // Same as current language
          return { unsubscribe: jest.fn() };
        },
      })),
      set: jest.fn(),
    }));

    renderHook(() => useLanguagePreference());

    expect(mockLanguageApi.setLanguage).not.toHaveBeenCalled();
  });

  it('should prevent sync loop when update comes from user settings', async () => {
    const setFn = jest.fn();

    (mockStorageApi.forBucket as jest.Mock).mockImplementation(() => ({
      snapshot: jest.fn(() => ({ value: 'en' })),
      observe$: jest.fn(() => ({
        subscribe: (cb: any) => {
          // Simulate storage update
          cb({ value: 'fr' });
          return { unsubscribe: jest.fn() };
        },
      })),
      set: setFn,
    }));

    // Mock languageApi.setLanguage to trigger a language change
    mockLanguageApi.setLanguage.mockImplementation(newLang => {
      (useObservable as jest.Mock).mockReturnValue({ language: newLang });
    });

    const { rerender } = renderHook(() => useLanguagePreference());

    // Trigger the effect that would normally cause a sync loop
    rerender();

    // Should not call set because the update came from user settings
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(setFn).not.toHaveBeenCalled();
  });
});
