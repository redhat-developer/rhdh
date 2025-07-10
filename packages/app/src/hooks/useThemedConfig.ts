import { useEffect, useState } from 'react';

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

/**
 * Gets a config value based on the user's system theme.
 */
export const useSystemThemedConfig = (
  key: 'app.branding.fullLogo' | 'app.branding.iconLogo',
) => {
  const configApi = useApi(configApiRef);

  /** The fullLogo config specified by Red Hat Developer Hub */
  const fullLogo = configApi.getOptional<fullLogoType | iconLogoType>(key);

  const [colorScheme, setColorScheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event: MediaQueryListEvent) => {
      setColorScheme(event.matches ? 'dark' : 'light');
    };

    mediaQuery.addEventListener('change', handleChange);
    setColorScheme(mediaQuery.matches ? 'dark' : 'light');

    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, []);

  return typeof fullLogo === 'string' ? fullLogo : fullLogo?.[colorScheme];
};
