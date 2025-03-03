import { Link, useSidebarOpenState } from '@backstage/core-components';
import { configApiRef, useApi } from '@backstage/core-plugin-api';

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

export const SidebarLogo = () => {
  const { classes } = useStyles();
  const { isOpen } = useSidebarOpenState();
  const configApi = useApi(configApiRef);
  const logoFullBase64URI = configApi.getOptionalString(
    'app.branding.fullLogo',
  );
  const fullLogoWidth = configApi
    .getOptional('app.branding.fullLogoWidth')
    ?.toString();

  const logoIconBase64URI = configApi.getOptionalString(
    'app.branding.iconLogo',
  );

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
