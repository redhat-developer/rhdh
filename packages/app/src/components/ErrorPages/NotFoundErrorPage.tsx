import type { AppComponents } from '@backstage/core-plugin-api';

import { ErrorPage } from './ErrorPage';

export const NotFoundErrorPage: AppComponents['NotFoundErrorPage'] = () => (
  <ErrorPage
    status="404"
    statusMessage="We couldn't find that page"
    additionalInfo="The page you are looking for might have been removed, had its name
        changed, or is temporarily unavailable."
  />
);
