import { createTranslationResource } from '@backstage/core-plugin-api/alpha';
import { kubernetesTranslationRef } from '@backstage/plugin-kubernetes';

export const kubernetesTranslations = createTranslationResource({
  ref: kubernetesTranslationRef,
  translations: {},
});

export { kubernetesTranslationRef };
