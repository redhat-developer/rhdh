import { Content } from "@backstage/core-components";
import {
  UserSettingsAppearanceCard,
  UserSettingsIdentityCard,
  UserSettingsProfileCard,
} from "@backstage/plugin-user-settings";

import Grid from "@mui/material/Grid";

import { InfoCard } from "./InfoCard";

/**
 * RHDH General settings body. Matches upstream NFS
 * `sub-page:user-settings/general`, which wraps the card grid in
 * `Content` for page padding, and adds the local build-metadata InfoCard.
 */
export const GeneralPage = () => {
  return (
    <Content>
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
    </Content>
  );
};
