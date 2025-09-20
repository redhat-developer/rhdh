import { ComponentProps } from 'react';

import {
  CopyTextButton,
  type ErrorPage as BsErrorPage,
} from '@backstage/core-components';

import Box, { BoxProps } from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';

import { ContactSupportButton } from './errorButtons/ContactSupportButton';
import { GoBackButton } from './errorButtons/GoBackButton';
import { CollaborationIllustration } from './illustrations/collaboration/collaboration';

/** Private type duplicated from `@backstage/core-components` */
export type ErrorPageProps = ComponentProps<typeof BsErrorPage>;

const ErrorPageGutters = {
  xs: 3,
  md: 6,
  lg: 9,
  xl: 12,
};

const getIllustrationForStatus = (status?: string) => {
  switch (status) {
    default:
      return CollaborationIllustration;
  }
};

const IllustrationForStatus = ({
  status,
  ...props
}: { status?: string } & BoxProps<'img'>) => {
  const Illustration = getIllustrationForStatus(status);
  return <Illustration {...props} />;
};

export const ErrorPage = ({
  status,
  statusMessage,
  additionalInfo,
  supportUrl,
  stack,
}: ErrorPageProps) => (
  <Grid
    container
    sx={{
      flexGrow: 1,
      backgroundColor: theme => theme.palette.background.default,
      borderRadius: theme => theme.shape.borderRadius,
      // When quickstart drawer is open, adjust margin
      '.quickstart-drawer-open &': {
        transition: 'margin-right 0.3s ease',
        marginRight: 'var(--quickstart-drawer-width, 500px)',
        width: 'auto',
      },
    }}
    spacing={0}
  >
    <Grid
      item
      xs={12}
      md={6}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
      }}
    >
      <Box
        sx={{
          px: ErrorPageGutters,
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
        }}
      >
        <Typography variant="h1" gutterBottom>
          <strong>{status}</strong> {statusMessage}
        </Typography>

        <Typography variant="subtitle1" gutterBottom>
          {additionalInfo}
        </Typography>

        {stack && (
          <Box
            sx={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              backgroundColor: theme => theme.palette.background.paper,
              position: 'relative',
              padding: 2,
              borderRadius: 2,
            }}
          >
            <Typography
              variant="body2"
              color="textSecondary"
              fontFamily="monospace"
            >
              {stack}
            </Typography>
            <Box sx={{ position: 'absolute', right: 8, top: 8 }}>
              <CopyTextButton text={stack} />
            </Box>
          </Box>
        )}

        <Box data-testid="error-page-actions" sx={{ display: 'flex', gap: 1 }}>
          {status === '404' && <GoBackButton />}
          <ContactSupportButton supportUrl={supportUrl} />
        </Box>
      </Box>
    </Grid>
    <Grid item xs={12} md={6} sx={{ display: 'flex' }}>
      <IllustrationForStatus
        status={status}
        sx={{
          maxWidth: '100%',
          maxHeight: '100vh',
          objectFit: 'contain',
          px: ErrorPageGutters,
        }}
      />
    </Grid>
  </Grid>
);
