import type { ComponentType } from "react";

import {
  Link,
  sidebarConfig,
  useSidebarOpenState,
} from "@backstage/core-components";
import { configApiRef, useApi } from "@backstage/core-plugin-api";
import {
  LogoFull,
  LogoIcon,
} from "@red-hat-developer-hub/backstage-plugin-theme";
import Box from "@mui/material/Box";

import { useAppBarThemedConfig } from "../../hooks/useThemedConfig";
import { useTranslation } from "../../hooks/useTranslation";

const LogoRender = ({
  base64Logo,
  DefaultLogo,
  width,
  altText,
}: {
  base64Logo: string | undefined;
  DefaultLogo: ComponentType<React.ComponentProps<"svg">>;
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
  const { isOpen } = useSidebarOpenState();
  const { t } = useTranslation();
  const configApi = useApi(configApiRef);

  const drawerWidth = isOpen
    ? sidebarConfig.drawerWidthOpen
    : sidebarConfig.drawerWidthClosed;

  const logoFullBase64URI = useAppBarThemedConfig("app.branding.fullLogo");
  const logoIconBase64URI = useAppBarThemedConfig("app.branding.iconLogo");

  const fullLogoWidth = configApi.getOptional<string | number>(
    "app.branding.fullLogoWidth",
  );

  return (
    <Box
      sx={{
        width: drawerWidth,
        height: 3 * sidebarConfig.logoHeight,
        display: "flex",
        flexFlow: "row nowrap",
        alignItems: "center",
        mb: "-14px",
      }}
    >
      <Link
        to="/"
        underline="none"
        aria-label={t("sidebar.home")}
        style={{
          width: drawerWidth,
          marginLeft: 24,
        }}
      >
        {isOpen ? (
          <LogoRender
            base64Logo={logoFullBase64URI}
            DefaultLogo={LogoFull}
            width={fullLogoWidth ?? 170}
            altText={t("sidebar.homeLogo")}
          />
        ) : (
          <LogoRender
            base64Logo={logoIconBase64URI}
            DefaultLogo={LogoIcon}
            width={28}
            altText={t("sidebar.homeLogo")}
          />
        )}
      </Link>
    </Box>
  );
};
