import { ComponentProps } from 'react';

import type { EmptyState as BsEmptyState } from '@backstage/core-components';

import Box, { BoxProps } from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';

import { CollaborationIllustration } from './illustrations/collaboration/collaboration';

/** Private type duplicated from `@backstage/core-components` */
export type EmptyStateProps = ComponentProps<typeof BsEmptyState>;

const EmptyStateGutters = {
  xs: 3,
  md: 6,
  lg: 9,
  xl: 12,
};

const getIllustrationForStatus = (status?: EmptyStateProps['missing']) => {
  if (typeof status === 'object' && 'customImage' in status) {
    const CustomImage = (props: BoxProps<'img'>) => (
      <Box {...props}>{status.customImage}</Box>
    );
    return CustomImage;
  }

  switch (status) {
    case 'field':
      return CollaborationIllustration;
    case 'info':
      return CollaborationIllustration;
    case 'content':
      return CollaborationIllustration;
    case 'data':
      return CollaborationIllustration;
    default:
      return CollaborationIllustration;
  }
};

const IllustrationForStatus = ({
  missing,
  ...props
}: { missing?: EmptyStateProps['missing'] } & BoxProps<'img'>) => {
  const Illustration = getIllustrationForStatus(missing);
  return <Illustration {...props} />;
};

export const EmptyState = ({
  title,
  description,
  missing,
  action,
}: EmptyStateProps) => (
  <Grid container sx={{ flexGrow: 1 }} spacing={0}>
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
          px: EmptyStateGutters,
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
        }}
      >
        <Typography variant="h1" gutterBottom>
          {title}
        </Typography>

        <Typography variant="subtitle1" gutterBottom>
          {description}
        </Typography>

        <Box data-testid="error-page-actions" sx={{ display: 'flex', gap: 1 }}>
          {action}
        </Box>
      </Box>
    </Grid>
    <Grid item xs={12} md={6} sx={{ display: 'flex' }}>
      <IllustrationForStatus
        missing={missing}
        sx={{
          maxWidth: '100%',
          maxHeight: '100vh',
          objectFit: 'contain',
          px: EmptyStateGutters,
        }}
      />
    </Grid>
  </Grid>
);
