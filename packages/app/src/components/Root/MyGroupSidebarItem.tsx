import { useEffect, useRef, type FC } from 'react';
import { useLocation } from 'react-router-dom';

import { IconComponent } from '@backstage/core-plugin-api';
import { MyGroupsSidebarItem } from '@backstage/plugin-org';

import Box from '@mui/material/Box';
import { styled, Theme, useTheme } from '@mui/material/styles';
import { ThemeConfig } from '@red-hat-developer-hub/backstage-plugin-theme';

const StyledMyGroupWrapper = styled(Box)(({ theme }: { theme: Theme }) => {
  const themeConfig = theme as ThemeConfig;
  const submenuBg =
    themeConfig.palette?.rhdh?.general?.sidebarItemSelectedBackgroundColor ||
    theme.palette.primary.main;
  return {
    '& a': { paddingLeft: '' },
    '& > div > div:last-child': {
      background: submenuBg,
      fontSize: 14,
    },
    '& > div > div:last-child > div:not(:first-child)': { minHeight: 40 },
    '& > div > div:last-child a': { fontSize: 14 },
    '& > div > div:last-child .MuiTypography-subtitle1, & > div > div:last-child .MuiTypography-caption':
      {
        fontSize: 14,
        fontWeight: 400,
      },
  };
});

export interface MyGroupSidebarItemProps {
  icon: IconComponent;
  singularTitle: string;
  pluralTitle: string;
  paddingLeft?: string;
}

/** Submenu hover/selected using only stable selectors: data-rhdh-mygroup + MUI classes (works when JSS is hashed to jss4-*). */
const MyGroupSubmenuGlobalStyles: FC<{
  selectedBg: string;
  selectedColor: string;
}> = ({ selectedBg, selectedColor }) => {
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      [data-rhdh-mygroup] > div > div:last-child .MuiLink-root {
        opacity: 0.7;
      }
      [data-rhdh-mygroup] .MuiLink-root:hover {
        background: transparent !important;
        color: ${selectedColor} !important;
        opacity: 1 !important;
      }
      [data-rhdh-mygroup] .MuiLink-root:hover .MuiTypography-root,
      [data-rhdh-mygroup] .MuiLink-root:hover .MuiTypography-subtitle1,
      [data-rhdh-mygroup] .MuiLink-root:hover .MuiTypography-caption {
        color: ${selectedColor} !important;
      }
      [data-rhdh-mygroup] .MuiLink-root[data-rhdh-selected="true"] {
        background: ${selectedBg} !important;
        color: ${selectedColor} !important;
        opacity: 1 !important;
      }
      [data-rhdh-mygroup] .MuiLink-root[data-rhdh-selected="true"] .MuiTypography-root,
      [data-rhdh-mygroup] .MuiLink-root[data-rhdh-selected="true"] .MuiTypography-subtitle1,
      [data-rhdh-mygroup] .MuiLink-root[data-rhdh-selected="true"] .MuiTypography-caption {
        color: ${selectedColor} !important;
      }
    `;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, [selectedBg, selectedColor]);
  return null;
};

export const MyGroupSidebarItem: FC<MyGroupSidebarItemProps> = ({
  icon,
  singularTitle,
  pluralTitle,
  paddingLeft,
}) => {
  const theme = useTheme();
  const themeConfig = theme as ThemeConfig;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  // Subsidebar hover/active: use theme.action.selected so it works in both light and dark mode
  const selectedItemBg =
    theme.palette.action?.selected ??
    theme.palette.action?.hover ??
    theme.palette.primary.main;
  const selectedColorRaw =
    (themeConfig.pageTheme?.rhdh?.colors as string | string[] | undefined) ||
    theme.palette.text.primary;
  const selectedColor =
    typeof selectedColorRaw === 'string'
      ? selectedColorRaw
      : (selectedColorRaw?.[0] ?? theme.palette.text.primary);

  useEffect(() => {
    const root = wrapperRef.current;
    if (!root) return undefined;

    const applySelected = () => {
      const submenu = root.querySelector(':scope > div > div:last-child');
      if (!submenu) return;
      const pathname = window.location.pathname;
      submenu
        .querySelectorAll<HTMLAnchorElement>('.MuiLink-root')
        .forEach(a => {
          const isSelected =
            a.classList.toString().includes('selected') ||
            a.pathname === pathname ||
            pathname.startsWith(`${a.pathname}/`);
          a.setAttribute('data-rhdh-selected', isSelected ? 'true' : 'false');
        });
    };

    applySelected();
    const observer = new MutationObserver(applySelected);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [location.pathname]);

  return (
    <>
      <MyGroupSubmenuGlobalStyles
        selectedBg={selectedItemBg}
        selectedColor={selectedColor}
      />
      <StyledMyGroupWrapper
        ref={wrapperRef}
        data-rhdh-mygroup
        sx={paddingLeft ? { '& a': { paddingLeft } } : undefined}
      >
        <MyGroupsSidebarItem
          icon={icon}
          singularTitle={singularTitle}
          pluralTitle={pluralTitle}
        />
      </StyledMyGroupWrapper>
    </>
  );
};
