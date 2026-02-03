import {
  createTranslationMessages,
  createTranslationResource,
  TranslationRef,
  TranslationResource,
} from '@backstage/core-plugin-api/alpha';

import { InternalTranslationResource } from '../../types/types';

const createTranslationMessagesWrapper = (
  ref: TranslationRef<string, any>,
  messages: { [key: string]: string },
  full: boolean = false,
) => {
  return {
    default: createTranslationMessages({
      ref,
      full,
      messages,
    }),
  };
};

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

        const mergedMessages = {
          ...baseMessages.messages,
          ...overrides,
        } as { [key: string]: string };

        return createTranslationMessagesWrapper(ref, mergedMessages, false);
      };
    } else {
      // create translation resource for new/default locale(s) based on default resources
      resourceWithNewTranslations[res.language] = async () => {
        const baseMessages = await res.loader();
        return createTranslationMessagesWrapper(
          ref,
          baseMessages.messages as { [key: string]: string },
          false,
        );
      };
    }
  }

  // create translation resource for new locale(s) based on jsonTranslations passed
  for (const [locale] of Object.entries(jsonTranslations)) {
    if (!resourceWithNewTranslations[locale]) {
      resourceWithNewTranslations[locale] = async () => {
        const newLocaleTranslations: { [key: string]: string } =
          jsonTranslations[locale];

        return createTranslationMessagesWrapper(
          ref,
          newLocaleTranslations,
          false,
        );
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
