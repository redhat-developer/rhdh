import { Link, useSidebarOpenState } from '@backstage/core-components';
import { configApiRef, useApi } from '@backstage/core-plugin-api';

import { useTheme } from '@mui/material/styles';
import type { ThemeConfig } from '@red-hat-developer-hub/backstage-plugin-theme';
import { makeStyles } from 'tss-react/mui';

import LogoFull from './LogoFull';
import LogoIcon from './LogoIcon';

const useStyles = makeStyles()({
  sidebarLogo: {
    margin: '24px 0px 6px 24px',
  },
});

const LogoRender = ({
  base64Logo,
  defaultLogo,
  width,
}: {
  base64Logo: string | undefined;
  defaultLogo: React.JSX.Element;
  width: string | number;
}) => {
  return base64Logo ? (
    <img
      data-testid="home-logo"
      src={base64Logo}
      alt="Home logo"
      width={width}
    />
  ) : (
    defaultLogo
  );
};

type FullLogo =
  | {
      dark: string;
      light: string;
    }
  | string
  | undefined;

/**
 * Gets a themed image based on the current theme.
 */
const useThemedImage = (key: string) => {
  const theme = useTheme();

  const appBarBackgroundScheme =
    (theme as ThemeConfig)?.palette?.rhdh?.general?.appBarBackgroundScheme ??
    'dark';

  const configApi = useApi(configApiRef);

  /** The fullLogo config specified by Red Hat Developer Hub */
  const fullLogo = configApi.getOptional<FullLogo>(key);

  /** The dark theme full logo config */
  const darkLogoFullBase64URI =
    typeof fullLogo === 'string' ? undefined : fullLogo?.dark;

  /** The light theme full logo config */
  const lightLogoFullBase64URI =
    typeof fullLogo === 'string' ? fullLogo : fullLogo?.light;

  return appBarBackgroundScheme === 'dark'
    ? darkLogoFullBase64URI
    : lightLogoFullBase64URI;
};

export const SidebarLogo = () => {
  const { classes } = useStyles();
  const { isOpen } = useSidebarOpenState();

  const configApi = useApi(configApiRef);

  const logoFullBase64URI = useThemedImage('app.branding.fullLogo');

  const fullLogoWidth = configApi
    .getOptional('app.branding.fullLogoWidth')
    ?.toString();

  const logoIconBase64URI = useThemedImage('app.branding.iconLogo');

  return (
    <div className={classes.sidebarLogo}>
      <Link to="/" underline="none" aria-label="Home">
        {isOpen ? (
          <LogoRender
            base64Logo={logoFullBase64URI}
            defaultLogo={<LogoFull />}
            width={fullLogoWidth ?? 170}
          />
        ) : (
          <LogoRender
            base64Logo={logoIconBase64URI}
            defaultLogo={<LogoIcon />}
            width={28}
          />
        )}
      </Link>
    </div>
  );
};
