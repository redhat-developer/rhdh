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
    // update translations for existing locale(s)
    if (jsonTranslations[res.language]) {
      resourceWithNewTranslations[res.language] = async () => {
        const overrides: { [key: string]: string } =
          jsonTranslations[res.language];
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
          jsonTranslations[locale];

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
