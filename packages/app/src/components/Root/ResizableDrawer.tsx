import { useCallback, useEffect, useRef, useState } from 'react';

import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import { styled } from '@mui/material/styles';
import { ThemeConfig } from '@red-hat-developer-hub/backstage-plugin-theme';

const Handle = styled('div')(({ theme }) => ({
  width: 6,
  cursor: 'col-resize',
  position: 'absolute',
  top: 0,
  left: 0,
  bottom: 0,
  zIndex: 1201,
  backgroundColor: theme.palette.divider,
}));

export type ResizableDrawerProps = {
  children: React.ReactNode;
  minWidth?: number;
  maxWidth?: number;
  initialWidth?: number;
  isDrawerOpen: boolean;
  drawerWidth?: number;
  onWidthChange?: (width: number) => void;
  isResizable?: boolean;
  [key: string]: any;
};

export const ResizableDrawer = (props: ResizableDrawerProps) => {
  const {
    children,
    minWidth = 400,
    maxWidth = 800,
    initialWidth = 400,
    isDrawerOpen,
    isResizable = false,
    drawerWidth: externalDrawerWidth,
    onWidthChange,
    ...drawerProps
  } = props;

  // Ensure width is never below minWidth
  const clampedInitialWidth = Math.max(
    externalDrawerWidth || initialWidth,
    minWidth,
  );

  const [width, setWidth] = useState(clampedInitialWidth);
  const resizingRef = useRef(false);

  // Sync with external drawerWidth when it changes
  useEffect(() => {
    if (externalDrawerWidth !== undefined) {
      const clampedWidth = Math.max(externalDrawerWidth, minWidth);
      if (clampedWidth !== width) {
        setWidth(clampedWidth);
        // If the external width was below min, update the parent
        if (externalDrawerWidth < minWidth && onWidthChange && isResizable) {
          onWidthChange(clampedWidth);
        }
      }
    }
  }, [externalDrawerWidth, width, minWidth, onWidthChange, isResizable]);

  const onMouseDown = () => {
    resizingRef.current = true;
  };

  const onMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!resizingRef.current) return;
      // For right-anchored drawer, calculate width from the right edge
      const newWidth = globalThis.innerWidth - e.clientX;

      if (newWidth >= minWidth && newWidth <= maxWidth) {
        setWidth(newWidth);
        if (onWidthChange) {
          onWidthChange(newWidth);
        }
      }
    },
    [maxWidth, minWidth, onWidthChange],
  );

  const onMouseUp = () => {
    resizingRef.current = false;
  };

  useEffect(() => {
    if (isResizable) {
      globalThis.addEventListener('mousemove', onMouseMove);
      globalThis.addEventListener('mouseup', onMouseUp);
      return () => {
        globalThis.removeEventListener('mousemove', onMouseMove);
        globalThis.removeEventListener('mouseup', onMouseUp);
      };
    }
    return () => {};
  }, [onMouseMove, isResizable]);

  // Ensure anchor is always 'right' and not overridden by drawerProps
  const { anchor: _, ...restDrawerProps } = drawerProps;

  return (
    <Drawer
      {...restDrawerProps}
      anchor="right"
      sx={{
        '& .v5-MuiDrawer-paper': {
          width: width,
          boxSizing: 'border-box',
          backgroundColor: theme => {
            const themeConfig = theme as ThemeConfig;
            return (
              themeConfig.palette?.rhdh?.general?.sidebarBackgroundColor ||
              theme.palette.background.paper
            );
          },
          justifyContent: 'space-between',
        },
        // Only apply header offset when global header exists
        'body:has(#global-header) &': {
          '& .v5-MuiDrawer-paper': {
            top: '64px !important',
            height: 'calc(100vh - 64px) !important',
          },
        },
      }}
      variant="persistent"
      open={isDrawerOpen}
    >
      <Box sx={{ height: '100%', position: 'relative' }}>
        {children}
        {isResizable && <Handle onMouseDown={onMouseDown} />}
      </Box>
    </Drawer>
  );
};
