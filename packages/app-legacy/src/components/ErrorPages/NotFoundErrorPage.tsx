import type { AppComponents } from '@backstage/core-plugin-api';

import { useTranslation } from '../../hooks/useTranslation';
import { ErrorPage } from './ErrorPage';

export const NotFoundErrorPage: AppComponents['NotFoundErrorPage'] = () => {
  const { t } = useTranslation();

  return (
    <ErrorPage
      status="404"
      statusMessage={t('app.errors.notFound.message')}
      additionalInfo={t('app.errors.notFound.additionalInfo')}
    />
  );
};
