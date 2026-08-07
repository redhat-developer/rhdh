import { useEffect, useRef } from 'react';
import { useAsync } from 'react-use';
import useObservable from 'react-use/esm/useObservable';

import {
  configApiRef,
  identityApiRef,
  storageApiRef,
  useApi,
} from '@backstage/core-plugin-api';
import { appLanguageApiRef } from '@backstage/core-plugin-api/alpha';

import { TranslationConfig } from '../types/types';
import { getDefaultLanguage } from '../utils/language/language';

const BUCKET = 'userSettings';
const KEY = 'language';
const GUEST_USER_REF = 'user:development/guest';

/**
 * Hook that provides bidirectional synchronization of language preferences
 * between the app's language API and user storage when database persistence is enabled.
 *
 * Features:
 * - Persists language changes to user storage (database only)
 * - Restores language preferences on page load
 * - Prevents sync for guest users
 * - Includes safeguards against sync loops and hydration issues
 *
 * @returns The current language preference (string or undefined)
 */
export const useLanguagePreference = (): string | undefined => {
  const languageApi = useApi(appLanguageApiRef);
  const storageApi = useApi(storageApiRef);
  const identityApi = useApi(identityApiRef);
  const configApi = useApi(configApiRef);

  const { value, loading } = useAsync(() => identityApi.getBackstageIdentity());
  const isGuestUser = value?.userEntityRef === GUEST_USER_REF;
  const persistence =
    configApi.getOptionalString('userSettings.persistence') ?? 'database';
  const config = configApi.getOptionalConfig('i18n');

  const translationConfig: TranslationConfig = {
    locales: config?.getStringArray('locales') ?? ['en'],
    defaultLocale: config?.getOptional('defaultLocale'),
  };

  const isDatabasePersistence = persistence === 'database';

  // Validate persistence configuration
  if (persistence !== 'database' && persistence !== 'browser') {
    // eslint-disable-next-line no-console
    console.warn(
      `useLanguagePreference: Invalid userSettings.persistence value: "${persistence}". Expected "database" or "browser". Defaulting to database.`,
    );
  }

  const shouldSync = !loading && !isGuestUser && isDatabasePersistence;

  const language = useObservable(languageApi.language$(), {
    language: languageApi.getLanguage().language,
  })?.language;

  const lastUpdateFromUserSettings = useRef(false);
  const hydrated = useRef(false);
  const mounted = useRef(true);

  const defaultLanguage = getDefaultLanguage(translationConfig);

  // User settings → language api
  useEffect(() => {
    if (!shouldSync) {
      return () => {}; // Return empty cleanup function
    }

    let subscription: { unsubscribe: () => void } | null = null;

    const storage = storageApi.forBucket(BUCKET);
    try {
      subscription = storage.observe$<string>(KEY).subscribe(stored => {
        if (mounted.current && stored.presence === 'absent') {
          languageApi.setLanguage(defaultLanguage);
          storage.set(KEY, defaultLanguage);
        }
        if (
          mounted.current &&
          stored?.value &&
          stored.value !== languageApi.getLanguage().language
        ) {
          lastUpdateFromUserSettings.current = true;
          languageApi.setLanguage(stored.value);
        }
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(
        'useLanguagePreference: Failed to set up language storage subscription:',
        error,
      );
    }

    return () => {
      if (subscription) {
        try {
          subscription.unsubscribe();
        } catch (error) {
          // eslint-disable-next-line no-console
          console.warn(
            'useLanguagePreference: Failed to unsubscribe from language storage:',
            error,
          );
        }
      }
    };
  }, [storageApi, shouldSync, languageApi, defaultLanguage]);

  // Cleanup mounted flag on unmount
  useEffect(() => {
    return () => {
      mounted.current = false;
    };
  }, []);

  // Language Api → user settings storage
  useEffect(() => {
    if (!shouldSync || !language) return;

    if (!hydrated.current) {
      // First time after refresh, don’t sync back
      hydrated.current = true;
      return;
    }

    if (lastUpdateFromUserSettings.current) {
      lastUpdateFromUserSettings.current = false;
      return;
    }

    storageApi
      .forBucket(BUCKET)
      .set(KEY, language)
      .catch(e => {
        // eslint-disable-next-line no-console
        console.warn(
          'useLanguagePreference: Failed to store language in user-settings storage',
          e,
        );
      });
  }, [language, shouldSync, storageApi]);

  return language;
};
