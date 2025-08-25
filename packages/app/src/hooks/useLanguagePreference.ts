import { useEffect, useRef } from 'react';
import { useAsync } from 'react-use';
import useObservable from 'react-use/esm/useObservable';

import {
  identityApiRef,
  storageApiRef,
  useApi,
} from '@backstage/core-plugin-api';
import { appLanguageApiRef } from '@backstage/core-plugin-api/alpha';

const BUCKET = 'userSettings';
const KEY = 'language';

export const useLanguagePreference = () => {
  const languageApi = useApi(appLanguageApiRef);
  const storageApi = useApi(storageApiRef);
  const identityApi = useApi(identityApiRef);

  const { value, loading } = useAsync(() => identityApi.getBackstageIdentity());
  const isGuestUser = value?.userEntityRef === 'user:development/guest';
  const shouldSync = !loading && !isGuestUser;

  const language = useObservable(languageApi.language$(), {
    language: languageApi.getLanguage().language,
  })?.language;

  const lastUpdateFromUserSettings = useRef(false);
  const hydrated = useRef(false);
  const mounted = useRef(true);

  // User settings → language api
  useEffect(() => {
    if (!shouldSync) {
      return () => {}; // Return empty cleanup function
    }

    let subscription: { unsubscribe: () => void } | null = null;

    try {
      subscription = storageApi
        .forBucket(BUCKET)
        .observe$<string>(KEY)
        .subscribe(stored => {
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
      console.warn('Failed to set up language storage subscription:', error);
    }

    return () => {
      if (subscription) {
        try {
          subscription.unsubscribe();
        } catch (error) {
          // eslint-disable-next-line no-console
          console.warn('Failed to unsubscribe from language storage:', error);
        }
      }
    };
  }, [storageApi, shouldSync, languageApi]);

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
        console.warn('Failed to store language in user-settings storage', e);
      });
  }, [language, shouldSync, storageApi]);

  return language;
};
