import type { ConfigApi } from '@backstage/core-plugin-api';

import type { i18n as I18n } from 'i18next';
import Pseudo from 'i18next-pseudo';

type TranslationApiWithI18n = {
  getI18nInstance?: () => I18n;
};

function mergePostProcess(i18n: I18n) {
  const cur = i18n.options.postProcess;
  let list: string[];
  if (!cur) {
    list = ['pseudo'];
  } else if (Array.isArray(cur)) {
    list = [...cur];
  } else {
    list = [cur as string];
  }
  if (!list.includes('pseudo')) {
    list.push('pseudo');
  }
  i18n.options.postProcess = list;
}

/**
 * When `?pseudolocalization=true` or `i18n.pseudolocalization.enabled` is set,
 * registers i18next-pseudo on the translation API's i18n instance (call once
 * after {@link I18nextTranslationApi.create}).
 */
export function attachPseudolocalizationIfEnabled(
  translationApi: unknown,
  configApi: ConfigApi,
): void {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get('pseudolocalization') === 'true';
  const fromConfig =
    configApi.getOptionalBoolean('i18n.pseudolocalization.enabled') ?? false;
  if (!fromQuery && !fromConfig) {
    return;
  }

  const api = translationApi as TranslationApiWithI18n;
  if (typeof api.getI18nInstance !== 'function') {
    return;
  }

  const i18n = api.getI18nInstance();
  const lngOverride =
    params.get('lng') ??
    configApi.getOptionalString('i18n.pseudolocalization.language') ??
    undefined;

  const pseudo = new Pseudo({
    enabled: true,
    wrapped: true,
    languageToPseudo:
      lngOverride ?? i18n.resolvedLanguage ?? i18n.language ?? 'en',
  });

  i18n.use(pseudo);
  mergePostProcess(i18n);

  const syncLanguageToPseudo = () => {
    const next = lngOverride ?? i18n.resolvedLanguage ?? i18n.language ?? 'en';
    pseudo.configurePseudo({ languageToPseudo: next });
  };

  syncLanguageToPseudo();
  i18n.on('languageChanged', syncLanguageToPseudo);

  if (process.env.NODE_ENV !== 'production') {
    (window as unknown as { i18n?: I18n }).i18n = i18n;
  }
}
