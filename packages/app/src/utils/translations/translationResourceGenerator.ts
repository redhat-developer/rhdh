import {
  createTranslationMessages,
  createTranslationResource,
  TranslationRef,
  TranslationResource,
} from '@backstage/core-plugin-api/alpha';

import { InternalTranslationResource } from '../../types/types';

const mergeTranslations = (
  resource: InternalTranslationResource<any>,
  jsonTranslations: { [key: string]: any },
  ref: TranslationRef<string, any>,
) => {
  const resourceWithNewTranslations: Record<string, any> = {};
  for (const res of resource.resources) {
    if (jsonTranslations[res.language]) {
      resourceWithNewTranslations[res.language] = async () => {
        const overrides: { [key: string]: string } =
          await jsonTranslations[res.language]();
        const baseMessages = await res.loader();

        const mergedMessages = { ...baseMessages.messages, ...overrides };

        return {
          default: createTranslationMessages({
            ref,
            full: false,
            messages: mergedMessages,
          }),
        };
      };
    }
  }

  // create translation resource for new locale(s)
  for (const [locale] of Object.entries(jsonTranslations)) {
    if (!resourceWithNewTranslations[locale]) {
      resourceWithNewTranslations[locale] = async () => {
        const newLocaleTranslations: { [key: string]: string } =
          await jsonTranslations[locale]();

        return {
          default: createTranslationMessages({
            ref,
            full: false,
            messages: newLocaleTranslations,
          }),
        };
      };
    }
  }

  return resourceWithNewTranslations;
};

export const translationResourceGenerator = (
  ref: TranslationRef<string, any>,
  resource: InternalTranslationResource<any>,
  jsonTranslations: { [key: string]: any },
): TranslationResource<string> => {
  return createTranslationResource({
    ref,
    translations: mergeTranslations(resource, jsonTranslations, ref),
  });
};
