import React from 'react';

import { SidebarItem } from '@backstage/core-components';

import { styled } from '@mui/material/styles';

import { useSidebarSelectedBackgroundColor } from '../../hooks/useThemedConfig';

// Simple styled wrapper that applies the custom background color
const StyledSidebarItemWrapper = styled('div')<{
  selectedBackgroundColor: string;
}>(({ selectedBackgroundColor }) => ({
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
 * Custom SidebarItem component that uses the configurable sidebar selected background color
 * from app-config.yaml. Falls back to default Backstage styling if not configured.
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
