import Box, { BoxProps } from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';

import { CollaborationIllustration } from './illustrations/collaboration/collaboration';

interface ErrorPageProps {
  /** The title to display. */
  title: React.ReactNode | string;
  /** The message to display. */
  message: React.ReactNode | string;
  /** Additional actions to display below the message. */
  actions?: React.ReactNode;
  /** Additional content to display below the message and above the actions. */
  children?: React.ReactNode;
  /** The component to use for the illustration. */
  Illustration?: React.ComponentType<BoxProps<'img'>>;
}

const ErrorPageGutters = {
  xs: 3,
  md: 6,
  lg: 9,
  xl: 12,
};

export const ErrorPage = ({
  title,
  message,
  actions,
  Illustration = CollaborationIllustration,
  children,
}: ErrorPageProps) => (
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
          px: ErrorPageGutters,
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
        }}
      >
        <Typography variant="h1" gutterBottom>
          {title}
        </Typography>

        <Typography variant="subtitle1" gutterBottom>
          {message}
        </Typography>

        {children}
        <div data-testid="error-page-actions">{actions}</div>
      </Box>
    </Grid>
    <Grid item xs={12} md={6} sx={{ display: 'flex' }}>
      <Illustration
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
