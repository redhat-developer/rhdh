import {
  UserSettingsAppearanceCard,
  UserSettingsIdentityCard,
  UserSettingsProfileCard,
} from '@backstage/plugin-user-settings';

import Grid from '@mui/material/Grid';

import { InfoCard } from './InfoCard';

export const GeneralPage = () => {
  return (
    <Grid container direction="row" spacing={3}>
      <Grid item xs={12} md={6}>
        <UserSettingsProfileCard />
      </Grid>
      <Grid item xs={12} md={6}>
        <UserSettingsAppearanceCard />
      </Grid>
      <Grid item xs={12} md={6}>
        <UserSettingsIdentityCard />
      </Grid>
      <Grid item xs={12} md={6}>
        <InfoCard />
      </Grid>
    </Grid>
  );
};
