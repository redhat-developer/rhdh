import type { ComponentType } from 'react';

import { Link, useSidebarOpenState } from '@backstage/core-components';
import { configApiRef, useApi } from '@backstage/core-plugin-api';

import { makeStyles } from 'tss-react/mui';

import { useAppBarThemedConfig } from '../../hooks/useThemedConfig';
import { useTranslation } from '../../hooks/useTranslation';
import { LogoFull } from './LogoFull';
import { LogoIcon } from './LogoIcon';

const useStyles = makeStyles()({
  sidebarLogo: {
    margin: '24px 0px 6px 24px',
  },
});

const LogoRender = ({
  base64Logo,
  DefaultLogo,
  width,
  altText,
}: {
  base64Logo: string | undefined;
  DefaultLogo: ComponentType<React.ComponentProps<'svg'>>;
  width: string | number;
  altText: string;
}) => {
  return base64Logo ? (
    <img data-testid="home-logo" src={base64Logo} alt={altText} width={width} />
  ) : (
    <DefaultLogo width={width} />
  );
};

export const SidebarLogo = () => {
  const { classes } = useStyles();
  const { isOpen } = useSidebarOpenState();

  const { t } = useTranslation();
  const configApi = useApi(configApiRef);

  const logoFullBase64URI = useAppBarThemedConfig('app.branding.fullLogo');

  const fullLogoWidth = configApi
    .getOptional('app.branding.fullLogoWidth')
    ?.toString();

  const logoIconBase64URI = useAppBarThemedConfig('app.branding.iconLogo');

  return (
    <div className={classes.sidebarLogo}>
      <Link to="/" underline="none" aria-label={t('sidebar.home')}>
        {isOpen ? (
          <LogoRender
            base64Logo={logoFullBase64URI}
            DefaultLogo={LogoFull}
            width={fullLogoWidth ?? 170}
            altText={t('sidebar.homeLogo')}
          />
        ) : (
          <LogoRender
            base64Logo={logoIconBase64URI}
            DefaultLogo={LogoIcon}
            width={28}
            altText={t('sidebar.homeLogo')}
          />
        )}
      </Link>
    </div>
  );
};
