import { configApiRef, useApi } from '@backstage/core-plugin-api';

import { useTheme } from '@mui/material/styles';
import type { ThemeConfig } from '@red-hat-developer-hub/backstage-plugin-theme';

import type { Config } from '../../config';

type fullLogoType = NonNullable<Config['app']['branding']>['fullLogo'];
type iconLogoType = NonNullable<Config['app']['branding']>['fullLogo'];

/**
 * Get the app bar background scheme from the theme. Defaults to 'dark' if not set.
 */
export const useAppBarBackgroundScheme = () => {
  const theme = useTheme();

  return (
    (theme as ThemeConfig)?.palette?.rhdh?.general?.appBarBackgroundScheme ??
    'dark'
  );
};

/**
 * Gets a config value based on the value of `theme.palette.rhdh.general.appBarBackgroundScheme`.
 */
export const useAppBarThemedConfig = (
  key: 'app.branding.fullLogo' | 'app.branding.iconLogo',
) => {
  const appBarBackgroundScheme = useAppBarBackgroundScheme();

  const configApi = useApi(configApiRef);

  /** The fullLogo config specified by Red Hat Developer Hub */
  const fullLogo = configApi.getOptional<fullLogoType | iconLogoType>(key);

  return typeof fullLogo === 'string'
    ? fullLogo
    : fullLogo?.[appBarBackgroundScheme];
};
