import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import DynamicRootContext from '@red-hat-developer-hub/plugin-utils';

import { ResizableDrawer } from './ResizableDrawer';

type DrawerState = {
  id: string;
  isDrawerOpen: boolean;
  drawerWidth: number;
  setDrawerWidth: (width: number) => void;
  closeDrawer: () => void;
};

type DrawerStateExposer = {
  Component: React.ComponentType<{
    onStateChange: (state: DrawerState) => void;
  }>;
};

type DrawerContent = {
  Component: React.ComponentType;
  config?: { id: string; props?: { resizable?: boolean } };
};

export const ApplicationDrawer = () => {
  const { mountPoints } = useContext(DynamicRootContext);

  // Get drawer content and its configurations
  const drawerContents = useMemo(
    () =>
      (mountPoints['application/internal/drawer-content'] ??
        []) as DrawerContent[],
    [mountPoints],
  );

  // Get drawer states from all state exposers
  const drawerStateExposers = useMemo(
    () =>
      (mountPoints['application/internal/drawer-state'] ??
        []) as DrawerStateExposer[],
    [mountPoints],
  );

  // Store drawer states from all plugins
  const drawerStatesRef = useRef<Map<string, DrawerState>>(new Map());
  const [activeDrawerId, setActiveDrawerId] = useState<string | null>(null);

  const handleDrawerStateChange = useCallback(
    (state: DrawerState) => {
      const prev = drawerStatesRef.current.get(state.id);

      // If drawer just opened, then transition from closed to open
      if (!prev?.isDrawerOpen && state.isDrawerOpen) {
        setActiveDrawerId(state.id);
      }
      // If drawer just closed and it was the active one, clear active drawer
      else if (
        prev?.isDrawerOpen &&
        !state.isDrawerOpen &&
        state.id === activeDrawerId
      ) {
        setActiveDrawerId(null);
      }

      drawerStatesRef.current.set(state.id, state);
    },
    [activeDrawerId],
  );

  const drawerStates = Array.from(drawerStatesRef.current.values());

  const allDrawers = useMemo(
    () =>
      drawerStates
        .map(state => {
          const content = drawerContents.find(c => c.config?.id === state.id);
          if (!content) return null;

          return {
            state,
            Component: content.Component,
            config: content.config,
          };
        })
        .filter(Boolean),
    [drawerStates, drawerContents],
  );

  const activeDrawer =
    allDrawers.find(d => d?.state.id === activeDrawerId) || null;

  // Close other drawers when one becomes active
  useEffect(() => {
    if (activeDrawerId) {
      drawerStates.forEach(state => {
        if (state.id !== activeDrawerId && state.isDrawerOpen) {
          state.closeDrawer();
        }
      });
    }
  }, [activeDrawerId, drawerStates]);

  // Manage CSS classes and variables for layout adjustments
  useEffect(() => {
    if (activeDrawer) {
      const className = 'docked-drawer-open';
      const cssVar = '--docked-drawer-width';

      document.body.classList.add(className);
      document.body.style.setProperty(
        cssVar,
        `${activeDrawer.state.drawerWidth}px`,
      );

      return () => {
        document.body.classList.remove(className);
        document.body.style.removeProperty(cssVar);
      };
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDrawer?.state.id, activeDrawer?.state.drawerWidth]);

  if (drawerContents.length === 0) {
    return null;
  }

  return (
    <>
      {/* Render the state exposers, they will call handleStateChange */}
      {drawerStateExposers.map(({ Component }, index) => (
        <Component
          // eslint-disable-next-line react/no-array-index-key
          key={`drawer-state-${Component.displayName || index}`}
          onStateChange={handleDrawerStateChange}
        />
      ))}

      {activeDrawer && (
        <ResizableDrawer
          isDrawerOpen={activeDrawer.state.isDrawerOpen}
          isResizable={activeDrawer.config?.props?.resizable ?? false}
          drawerWidth={activeDrawer.state.drawerWidth}
          onWidthChange={activeDrawer.state.setDrawerWidth}
        >
          <activeDrawer.Component />
        </ResizableDrawer>
      )}
    </>
  );
};
