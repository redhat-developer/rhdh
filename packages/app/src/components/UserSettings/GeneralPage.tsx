import { useContext } from 'react';

import { useApi } from '@backstage/core-plugin-api';
import { appLanguageApiRef } from '@backstage/core-plugin-api/alpha';
import {
  UserSettingsAppearanceCard,
  UserSettingsIdentityCard,
  UserSettingsProfileCard,
} from '@backstage/plugin-user-settings';

import Grid from '@mui/material/Grid';
import { ExportTranslationKeys } from '@red-hat-developer-hub/backstage-plugin-translations';
import DynamicRootContext from '@red-hat-developer-hub/plugin-utils';

import { InfoCard } from './InfoCard';

export const GeneralPage = () => {
  const context = useContext(DynamicRootContext);
  const languageApi = useApi(appLanguageApiRef);

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
      {languageApi.getAvailableLanguages().languages.length > 1 && (
        <Grid item xs={12} md={6}>
          <ExportTranslationKeys resources={context.translationRefs} />
        </Grid>
      )}
    </Grid>
  );
};
