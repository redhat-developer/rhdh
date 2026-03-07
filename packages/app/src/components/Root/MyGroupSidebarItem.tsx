import React from 'react';

import { IconComponent } from '@backstage/core-plugin-api';
import { MyGroupsSidebarItem } from '@backstage/plugin-org';
import Box from '@mui/material/Box';
import { styled, Theme } from '@mui/material/styles';
import { ThemeConfig } from '@red-hat-developer-hub/backstage-plugin-theme';

/**
 * Wrapper that styles MyGroupsSidebarItem submenu using
 * stable MUI classes and DOM structure (no Backstage internal classes).
 */
const StyledMyGroupWrapper = styled(Box)(({ theme }: { theme: Theme }) => {
  const themeConfig = theme as ThemeConfig;

  const submenuBg =
    themeConfig.palette?.rhdh?.general?.sidebarBackgroundColor ||
    theme.palette.background.paper;

  const selectedBg =
    themeConfig.palette?.rhdh?.general?.sidebarItemSelectedBackgroundColor ||
    theme.palette.primary.main;

  const selectedColor =
    (themeConfig.pageTheme?.rhdh?.colors as string | string[]) ||
    theme.palette.text.primary;

  return {
    '& a': {
      paddingLeft: '', // overridden when nested via sx
    },

    // Submenu flyout panel
    '& > div > div:last-child': {
      background: submenuBg,
      fontSize: 14,
    },

    // Submenu rows (skip title)
    '& > div > div:last-child > div:not(:first-child)': {
      minHeight: 40,
    },

    // Base link styling
    '& > div > div:last-child a': {
      fontSize: 14,
    },

    // Hover state
    '& > div > div:last-child a:hover': {
      background: selectedBg,
      color: selectedColor,
    },

    // Active link state
    '& > div > div:last-child a[aria-current="page"]': {
      background: selectedBg,
      color: selectedColor,
    },

    // Typography inside submenu items
    '& > div > div:last-child .MuiTypography-subtitle1': {
      fontSize: 14,
      fontWeight: 400,
      background: 'transparent',
    },

    '& > div > div:last-child .MuiTypography-caption': {
      fontSize: 14,
      fontWeight: 400,
    },
  };
});

export interface MyGroupSidebarItemProps {
  icon: IconComponent;
  singularTitle: string;
  pluralTitle: string;
  paddingLeft?: string; // used when rendering nested menu items
}

/**
 * Styled wrapper around Backstage MyGroupsSidebarItem
 * applying RHDH theme styles to submenu items.
 */
export const MyGroupSidebarItem: React.FC<MyGroupSidebarItemProps> = ({
  icon,
  singularTitle,
  pluralTitle,
  paddingLeft,
}) => {
  return (
    <StyledMyGroupWrapper
      sx={paddingLeft ? { '& a': { paddingLeft } } : undefined}
    >
      <MyGroupsSidebarItem
        icon={icon}
        singularTitle={singularTitle}
        pluralTitle={pluralTitle}
      />
    </StyledMyGroupWrapper>
  );
};