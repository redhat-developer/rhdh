import type { AppComponents } from '@backstage/core-plugin-api';

import Box from '@mui/material/Box';

import { ContactSupportButton } from './errorButtons/ContactSupportButton';
import { GoBackButton } from './errorButtons/GoBackButton';
import { ErrorPage } from './ErrorPage';

export const NotFoundErrorPage: AppComponents['NotFoundErrorPage'] = ({
  children,
}) => (
  <ErrorPage
    title={
      <>
        <strong>404</strong> We couldn't find that page
      </>
    }
    message="The page you are looking for might have been removed, had its name
        changed, or is temporarily unavailable."
    actions={
      <Box sx={{ display: 'flex', gap: 2 }}>
        <GoBackButton />
        <ContactSupportButton />
      </Box>
    }
  >
    {children}
  </ErrorPage>
);
