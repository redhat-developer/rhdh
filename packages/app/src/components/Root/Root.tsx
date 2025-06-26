import {
  FC,
  Fragment,
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
import { styled, SxProps } from '@mui/material/styles';
import DynamicRootContext, {
  ResolvedMenuItem,
} from '@red-hat-developer-hub/plugin-utils';

import { ApplicationHeaders } from './ApplicationHeaders';
import { MenuIcon } from './MenuIcon';
import { SidebarLogo } from './SidebarLogo';

/**
 * This is a workaround to remove the fix height of the Page component
 * to support the application headers (and the global header plugin)
 * without having multiple scrollbars.
 *
 * Note that we cannot target class names directly, due to obfuscation in production builds.
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
// this component is copied to rhdh-plugins/global-header packages/app/src/components/Root/Root.tsx and should be kept in sync
const PageWithoutFixHeight = styled(Box, {
  name: 'RHDHPageWithoutFixHeight',
  slot: 'root',
})(() => ({
  // Use the complete viewport (similar to how Backstage does it) and make the
  // page content part scrollable below. We also need to compensate for the
  // above-sidebar position of the global header as it takes up a fixed height
  // at the top of the page.
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',

  // This solves the same issue for techdocs, which was reported as
  // https://issues.redhat.com/browse/RHIDP-4637
  '.techdocs-reader-page > main': {
    height: 'unset',
  },
}));

// this component is copied to rhdh-plugins/global-header packages/app/src/components/Root/Root.tsx and should be kept in sync
const SidebarLayout = styled(Box, {
  name: 'RHDHPageWithoutFixHeight',
  slot: 'sidebarLayout',
  shouldForwardProp: prop =>
    prop !== 'aboveSidebarHeaderHeight' &&
    prop !== 'aboveMainContentHeaderHeight',
})(
  ({
    aboveSidebarHeaderHeight,
    aboveMainContentHeaderHeight,
  }: {
    aboveSidebarHeaderHeight?: number;
    aboveMainContentHeaderHeight?: number;
  }) => ({
    // We remove Backstage's 100vh on the content, and instead rely on flexbox
    // to take up the whole viewport.
    display: 'flex',
    flexGrow: 1,
    maxHeight: `calc(100vh - ${aboveSidebarHeaderHeight ?? 0}px)`,

    // BackstageSidebarPage-root
    '& > div': {
      display: 'flex',
      flexDirection: 'column',
      height: 'unset',
      flexGrow: 1,
      // Here we override the theme so that the Backstage default page suspense
      // takes up the whole height of the page instead of 100vh. The difference
      // lies in the height of the global header above the sidebar.
      '@media (min-width: 600px)': {
        '& > [class*="MuiLinearProgress-root"]': {
          height: 'unset',
          flexGrow: 1,
        },
      },
    },

    '& main': {
      // The height is controlled by the flexbox in the BackstageSidebarPage.
      height: `calc(100vh - ${aboveSidebarHeaderHeight! + aboveMainContentHeaderHeight!}px)`,
      flexGrow: 1,
    },

    // BackstageSidebarPage-root > nav > BackstageSidebar-root > BackstageSidebar-drawer
    '& > div > nav > div > div': {
      // We need to compensate for the above-sidebar position of the global header
      // as it takes up a fixed height at the top of the page.
      top: `max(0px, ${aboveSidebarHeaderHeight ?? 0}px)`,
    },
  }),
);

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
    <SidebarItem
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

const ExpandableMenuList: FC<ExpandableMenuListProps> = ({
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
  const aboveMainContentHeaderRef = useRef<HTMLDivElement>(null);
  const [aboveMainContentHeaderHeight, setAboveMainContentHeaderHeight] =
    useState(0);

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

  useLayoutEffect(() => {
    if (!aboveMainContentHeaderRef.current) return () => {};

    const updateHeight = () => {
      setAboveMainContentHeaderHeight(
        aboveMainContentHeaderRef.current!.getBoundingClientRect().height,
      );
    };

    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(aboveMainContentHeaderRef.current);

    return () => observer.disconnect();
  }, []);

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
          <SidebarItem
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
                  <SidebarItem
                    icon={renderIcon(child.icon ?? '')}
                    text={child.title}
                    onClick={() => handleClick(child.name)}
                  >
                    {child.children!.length > 0 &&
                      renderExpandIcon(isNestedMenuOpen)}
                  </SidebarItem>
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
            <Fragment key={menuItem.name}>
              {menuItem.children!.length === 0 && getMenuItem(menuItem)}
              {menuItem.children!.length > 0 && (
                <SidebarItem
                  key={menuItem.name}
                  icon={renderIcon(menuItem.icon ?? '')}
                  text={menuItem.title}
                  onClick={() => handleClick(menuItem.name)}
                >
                  {menuItem.children!.length > 0 && renderExpandIcon(isOpen)}
                </SidebarItem>
              )}
              {menuItem.children!.length > 0 &&
                renderExpandableMenuItems(menuItem, isOpen)}
            </Fragment>
          );
        })}
      </>
    );
  };

  return (
    <PageWithoutFixHeight>
      <div id="rhdh-above-sidebar-header-container" ref={aboveSidebarHeaderRef}>
        <ApplicationHeaders position="above-sidebar" />
      </div>
      <SidebarLayout
        id="rhdh-sidebar-layout"
        aboveSidebarHeaderHeight={aboveSidebarHeaderHeight}
        aboveMainContentHeaderHeight={aboveMainContentHeaderHeight}
      >
        <SidebarPage>
          <div
            id="rhdh-above-main-content-header-container"
            ref={aboveMainContentHeaderRef}
          >
            <ApplicationHeaders position="above-main-content" />
          </div>
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
      </SidebarLayout>
    </PageWithoutFixHeight>
  );
};
