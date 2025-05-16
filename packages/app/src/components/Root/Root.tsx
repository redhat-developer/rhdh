import React, {
  PropsWithChildren,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import {
  Sidebar,
  SidebarDivider,
  SidebarGroup,
  SidebarItem,
  SidebarPage,
  SidebarScrollWrapper,
  SidebarSpace,
} from '@backstage/core-components';
import { configApiRef, useApi } from '@backstage/core-plugin-api';
import { MyGroupsSidebarItem } from '@backstage/plugin-org';
import { usePermission } from '@backstage/plugin-permission-react';
import { SidebarSearchModal } from '@backstage/plugin-search';
import { Settings as SidebarSettings } from '@backstage/plugin-user-settings';

import { policyEntityCreatePermission } from '@backstage-community/plugin-rbac-common';
import { AdminIcon } from '@internal/plugin-dynamic-plugins-info';
import AccountCircleOutlinedIcon from '@mui/icons-material/AccountCircleOutlined';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMore from '@mui/icons-material/ExpandMore';
import MuiMenuIcon from '@mui/icons-material/Menu';
import SearchIcon from '@mui/icons-material/Search';
import Box from '@mui/material/Box';
import Collapse from '@mui/material/Collapse';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import { SxProps } from '@mui/material/styles';
import { makeStyles } from 'tss-react/mui';

import DynamicRootContext, {
  ResolvedMenuItem,
} from '../DynamicRoot/DynamicRootContext';
import { ApplicationHeaders } from './ApplicationHeaders';
import { MenuIcon } from './MenuIcon';
import { SidebarLogo } from './SidebarLogo';

type StylesProps = { aboveSidebarHeaderHeight?: number };

const useStyles = makeStyles<StylesProps>()((_, props: StylesProps) => ({
  /**
   * This is a workaround to remove the fix height of the Page component
   * to support the application headers (and the global header plugin)
   * without having multiple scrollbars.
   *
   * This solves also the duplicate scrollbar issues in tech docs:
   * https://issues.redhat.com/browse/RHIDP-4637 (Scrollbar for docs behaves weirdly if there are over a page of headings)
   *
   * Which was also reported and tried to fix upstream:
   * https://github.com/backstage/backstage/issues/13717
   * https://github.com/backstage/backstage/pull/14138
   * https://github.com/backstage/backstage/issues/19427
   * https://github.com/backstage/backstage/issues/22745
   *
   * See also
   * https://github.com/backstage/backstage/blob/v1.35.0/packages/core-components/src/layout/Page/Page.tsx#L31-L34
   *
   * The following rules are based on the current DOM structure
   *
   * ```
   * <body>
   *   <div id="root">
   *     // snackbars and toasts
   *     <div className="pageWithoutFixHeight">
   *       <nav />                               // Optional nav(s) if a header with position: above-sidebar is configured
   *       <div>                                 // Backstage SidebarPage component
   *         <nav />                             // Optional nav(s) if a header with position: above-main-content is configured
   *         <nav aria-label="sidebar nav" />    // Sidebar content
   *         <main />                            // Backstage Page component
   *       </div>
   *     </div>
   *   </div>
   *   // some modals and other overlays
   * </body>
   * ```
   */
  pageWithoutFixHeight: {
    // Use 100vh for the complete viewport (similar to how Backstage does it)
    // and makes the page content part scrollable below...
    // But instead of using 100vh on the content below,
    // we use it here so that it includes the header.
    '> div[class*="-sidebarLayout"]': {
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
    },

    // But we unset the Backstage default 100vh value here and use flex box
    // to grow to the full height of the parent container.
    '> div > main': {
      height: 'unset',
      flexGrow: 1,
    },
    // This solves the same issue for techdocs, which was reported as
    // https://issues.redhat.com/browse/RHIDP-4637
    '.techdocs-reader-page > main': {
      height: 'unset',
    },
  },
  sidebarItem: {
    textDecorationLine: 'none',
  },
  sidebarLayout: {
    '& div[class*="BackstageSidebar-drawer"]': {
      top: Math.max(props.aboveSidebarHeaderHeight ?? 0, 0),
    },
  },
}));

// Backstage does not expose the props object, pulling it from the component argument
type SidebarItemProps = Parameters<typeof SidebarItem>[0];

const SideBarItemWrapper = (props: SidebarItemProps) => {
  const {
    classes: { sidebarItem },
  } = useStyles({});
  return (
    <SidebarItem
      {...props}
      className={`${sidebarItem} ${props.className ?? ''}`}
    />
  );
};

const renderIcon = (iconName: string) => () => <MenuIcon icon={iconName} />;

const renderExpandIcon = (expand: boolean) => {
  return expand ? (
    <ExpandMore
      fontSize="small"
      style={{
        display: 'flex',
        marginLeft: 8,
      }}
    />
  ) : (
    <ChevronRightIcon
      fontSize="small"
      style={{
        display: 'flex',
        marginLeft: 8,
      }}
    />
  );
};

const getMenuItem = (menuItem: ResolvedMenuItem, isNestedMenuItem = false) => {
  const menuItemStyle = {
    paddingLeft: isNestedMenuItem ? '2rem' : '',
  };
  return menuItem.name === 'default.my-group' ? (
    <Box key={menuItem.name} sx={{ '& a': menuItemStyle }}>
      <MyGroupsSidebarItem
        key={menuItem.name}
        icon={renderIcon(menuItem.icon ?? '')}
        singularTitle={menuItem.title}
        pluralTitle={`${menuItem.title}s`}
      />
    </Box>
  ) : (
    <SideBarItemWrapper
      key={menuItem.name}
      icon={renderIcon(menuItem.icon ?? '')}
      to={menuItem.to ?? ''}
      text={menuItem.title}
      style={menuItemStyle}
    />
  );
};

interface ExpandableMenuListProps {
  menuItems: ResolvedMenuItem[];
  isOpen: boolean;
  renderItem: (item: ResolvedMenuItem) => JSX.Element;
  sx?: SxProps;
}

const ExpandableMenuList: React.FC<ExpandableMenuListProps> = ({
  menuItems,
  isOpen,
  renderItem,
  sx = {},
}) => {
  if (!menuItems || menuItems.length === 0) return null;

  return (
    <Collapse in={isOpen} timeout="auto" unmountOnExit>
      <List disablePadding sx={sx}>
        {menuItems.map(item => renderItem(item))}
      </List>
    </Collapse>
  );
};

export const Root = ({ children }: PropsWithChildren<{}>) => {
  const aboveSidebarHeaderRef = useRef<HTMLDivElement>(null);
  const [aboveSidebarHeaderHeight, setAboveSidebarHeaderHeight] = useState(0);

  useLayoutEffect(() => {
    if (!aboveSidebarHeaderRef.current) return () => {};

    const updateHeight = () => {
      setAboveSidebarHeaderHeight(
        aboveSidebarHeaderRef.current!.getBoundingClientRect().height,
      );
    };

    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(aboveSidebarHeaderRef.current);

    return () => observer.disconnect();
  }, []);

  const {
    classes: { pageWithoutFixHeight, sidebarLayout },
  } = useStyles({ aboveSidebarHeaderHeight: aboveSidebarHeaderHeight });

  const { dynamicRoutes, menuItems } = useContext(DynamicRootContext);

  const configApi = useApi(configApiRef);

  const showLogo = configApi.getOptionalBoolean('app.sidebar.logo') ?? true;
  const showSearch = configApi.getOptionalBoolean('app.sidebar.search') ?? true;
  const showSettings =
    configApi.getOptionalBoolean('app.sidebar.settings') ?? true;
  const showAdministration =
    configApi.getOptionalBoolean('app.sidebar.administration') ?? true;

  const [openItems, setOpenItems] = useState<{ [key: string]: boolean }>({});

  const { loading: loadingPermission, allowed: canDisplayRBACMenuItem } =
    usePermission({
      permission: policyEntityCreatePermission,
      resourceRef: undefined,
    });

  const handleClick = (itemName: string) => {
    setOpenItems(prevOpenItems => ({
      ...prevOpenItems,
      [itemName]: !prevOpenItems[itemName],
    }));
  };

  const renderExpandableNestedMenuItems = (
    menuItem: ResolvedMenuItem,
    isSubMenuOpen: boolean,
  ) => {
    return (
      <ExpandableMenuList
        menuItems={menuItem.children ?? []}
        isOpen={isSubMenuOpen}
        sx={{
          paddingLeft: '4.25rem',
          fontSize: 12,
          '& span.MuiTypography-subtitle2': {
            fontSize: 12,
            whiteSpace: 'normal',
            wordBreak: 'break-word',
            overflowWrap: 'break-word',
          },
          '& div': { width: 36, boxShadow: '-1px 0 0 0 #3c3f42' },
          "& div[class*='BackstageSidebarItem-secondaryAction']": { width: 20 },
          a: {
            width: 'auto',
            '@media (min-width: 600px)': { width: 160 },
          },
        }}
        renderItem={child => (
          <SideBarItemWrapper
            key={child.title}
            icon={() => null}
            text={child.title}
            to={child.to ?? ''}
          />
        )}
      />
    );
  };

  const renderExpandableMenuItems = (
    menuItem: ResolvedMenuItem,
    isOpen: boolean,
  ) => {
    return (
      <ExpandableMenuList
        menuItems={menuItem.children ?? []}
        isOpen={isOpen}
        renderItem={child => {
          const isNestedMenuOpen = openItems[child.name] || false;
          return (
            <ListItem
              key={child.name}
              disableGutters
              disablePadding
              sx={{
                display: 'block',
                '& .MuiButton-label': { paddingLeft: '2rem' },
                "& span[class*='-subtitle2']": {
                  width: 78,
                  fontSize: 12,
                  whiteSpace: 'normal',
                  wordBreak: 'break-word',
                  overflowWrap: 'break-word',
                },
                "& div[class*='BackstageSidebarItem-secondaryAction']": {
                  width:
                    child.children && child.children.length === 0 ? 18 : 48,
                },
                a: {
                  width: 'auto',
                  '@media (min-width: 600px)': { width: 224 },
                },
              }}
            >
              {child.children && child.children.length === 0 ? (
                getMenuItem(child, true)
              ) : (
                <>
                  <SideBarItemWrapper
                    icon={renderIcon(child.icon ?? '')}
                    text={child.title}
                    onClick={() => handleClick(child.name)}
                  >
                    {child.children!.length > 0 &&
                      renderExpandIcon(isNestedMenuOpen)}
                  </SideBarItemWrapper>
                  {renderExpandableNestedMenuItems(child, isNestedMenuOpen)}
                </>
              )}
            </ListItem>
          );
        }}
      />
    );
  };

  const renderMenuItems = (
    isDefaultMenuSection: boolean,
    isBottomMenuSection: boolean,
  ) => {
    let menuItemArray = isDefaultMenuSection
      ? menuItems.filter(mi => mi.name.startsWith('default.'))
      : menuItems.filter(mi => !mi.name.startsWith('default.'));

    menuItemArray = isBottomMenuSection
      ? menuItemArray.filter(mi => mi.name === 'admin')
      : menuItemArray.filter(mi => mi.name !== 'admin');

    if (isBottomMenuSection && !canDisplayRBACMenuItem && !loadingPermission) {
      menuItemArray[0].children = menuItemArray[0].children?.filter(
        mi => mi.name !== 'rbac',
      );
    }
    return (
      <>
        {menuItemArray.map(menuItem => {
          const isOpen = openItems[menuItem.name] || false;
          return (
            <React.Fragment key={menuItem.name}>
              {menuItem.children!.length === 0 && getMenuItem(menuItem)}
              {menuItem.children!.length > 0 && (
                <SideBarItemWrapper
                  key={menuItem.name}
                  icon={renderIcon(menuItem.icon ?? '')}
                  text={menuItem.title}
                  onClick={() => handleClick(menuItem.name)}
                >
                  {menuItem.children!.length > 0 && renderExpandIcon(isOpen)}
                </SideBarItemWrapper>
              )}
              {menuItem.children!.length > 0 &&
                renderExpandableMenuItems(menuItem, isOpen)}
            </React.Fragment>
          );
        })}
      </>
    );
  };

  return (
    <div className={pageWithoutFixHeight}>
      <div id="above-sidebar-header-container" ref={aboveSidebarHeaderRef}>
        <ApplicationHeaders position="above-sidebar" />
      </div>
      <Box className={sidebarLayout}>
        <SidebarPage>
          <ApplicationHeaders position="above-main-content" />
          <Sidebar>
            {showLogo && <SidebarLogo />}
            {showSearch ? (
              <>
                <SidebarGroup label="Search" icon={<SearchIcon />} to="/search">
                  <SidebarSearchModal />
                </SidebarGroup>
                <SidebarDivider />
              </>
            ) : (
              <Box sx={{ height: '1.2rem' }} />
            )}
            <SidebarGroup label="Menu" icon={<MuiMenuIcon />}>
              {/* Global nav, not org-specific */}
              {renderMenuItems(true, false)}
              {/* End global nav */}
              <SidebarDivider />
              <SidebarScrollWrapper>
                {renderMenuItems(false, false)}
                {dynamicRoutes.map(({ scope, menuItem, path }) => {
                  if (menuItem && 'Component' in menuItem) {
                    return (
                      <menuItem.Component
                        {...(menuItem.config?.props || {})}
                        key={`${scope}/${path}`}
                        to={path}
                      />
                    );
                  }
                  return null;
                })}
              </SidebarScrollWrapper>
            </SidebarGroup>
            <SidebarSpace />
            {showAdministration && (
              <>
                <SidebarDivider />
                <SidebarGroup label="Administration" icon={<AdminIcon />}>
                  {renderMenuItems(false, true)}
                </SidebarGroup>
              </>
            )}
            {showSettings && (
              <>
                <SidebarDivider />
                <SidebarGroup
                  label="Settings"
                  to="/settings"
                  icon={<AccountCircleOutlinedIcon />}
                >
                  <SidebarSettings icon={AccountCircleOutlinedIcon} />
                </SidebarGroup>
              </>
            )}
          </Sidebar>
          {children}
        </SidebarPage>
      </Box>
    </div>
  );
};
