import {
  TranslationFunction,
  useTranslationRef,
} from '@backstage/core-plugin-api/alpha';

import { rhdhTranslationRef } from '../translations/rhdh/ref';

export const useTranslation = (): {
  t: TranslationFunction<typeof rhdhTranslationRef.T>;
} => useTranslationRef(rhdhTranslationRef);
