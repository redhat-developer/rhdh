import React from 'react';

import { SidebarItem } from '@backstage/core-components';

import { styled } from '@mui/material/styles';

import { useSidebarSelectedBackgroundColor } from '../../hooks/useThemedConfig';

// Simple styled wrapper that applies the custom background color
const StyledSidebarItemWrapper = styled('div')<{
  selectedBackgroundColor: string;
}>(({ selectedBackgroundColor }) => ({
  // Add spacing between sidebar items to prevent hover overlap
  marginBottom: '4px',

  // Target the selected/active sidebar item
  '& a[aria-current="page"]': {
    backgroundColor: `${selectedBackgroundColor} !important`,
  },
}));

// Global styles for built-in Backstage sidebar items (Settings, Search)
const GlobalSidebarStyles: React.FC<{ selectedBackgroundColor: string }> = ({
  selectedBackgroundColor,
}) => {
  React.useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      /* Target built-in Backstage sidebar items like Settings and Search */
      [class*="BackstageSidebarItem-selected"] {
        background-color: ${selectedBackgroundColor} !important;
      }
      /* Add spacing between all sidebar items to prevent hover overlap */
      [class*="BackstageSidebarItem-root"] {
        margin-bottom: 4px;
      }
    `;
    document.head.appendChild(style);

    return () => {
      document.head.removeChild(style);
    };
  }, [selectedBackgroundColor]);

  return null;
};

interface CustomSidebarItemProps {
  icon?: React.ComponentType<{}>;
  to: string;
  text: string;
  style?: React.CSSProperties;
}

/**
 * Custom SidebarItem component that uses the theme's sidebar selected background color.
 * Uses theme.palette.rhdh.general.sidebarItemSelectedBackgroundColor.
 */
export const CustomSidebarItem: React.FC<CustomSidebarItemProps> = ({
  icon,
  to,
  text,
  style,
}) => {
  const selectedBackgroundColor = useSidebarSelectedBackgroundColor();

  return (
    <>
      <GlobalSidebarStyles selectedBackgroundColor={selectedBackgroundColor} />
      <StyledSidebarItemWrapper
        selectedBackgroundColor={selectedBackgroundColor}
      >
        <SidebarItem icon={icon!} to={to} text={text} style={style} />
      </StyledSidebarItemWrapper>
    </>
  );
};
