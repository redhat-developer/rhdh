import { forwardRef } from 'react';

import Box from '@mui/material/Box';
import { styled } from '@mui/material/styles';
import type { SxProps, Theme } from '@mui/material/styles';

import { useScrollbar } from '../../hooks/useScrollbar';

interface ScrollableContainerProps {
  children: React.ReactNode;
  className?: string;
  sx?: SxProps<Theme>;
}

const ScrollContainer = styled(Box)(({ theme }) => ({
  position: 'relative',
  flex: 1,
  minHeight: 0,
  overflow: 'visible',
  '&:focus': {
    outline: `2px solid ${theme.palette.primary.main}`,
    outlineOffset: '-2px',
  },
}));

const ScrollContent = styled(Box)(() => ({
  height: '100%',
  overflow: 'hidden auto',
  paddingRight: '10px',
  marginRight: '0px',

  scrollbarWidth: 'none',
  msOverflowStyle: 'none',
  '&::-webkit-scrollbar': {
    display: 'none',
  },

  scrollBehavior: 'smooth',
  transform: 'translateZ(0)',
  WebkitOverflowScrolling: 'touch',
  overscrollBehavior: 'contain',
}));

const ScrollbarTrack = styled(Box)<{ visible: boolean }>(({ visible }) => ({
  position: 'absolute',
  top: 0,
  right: '2px',
  width: '6px',
  height: '100%',
  backgroundColor: 'transparent',
  opacity: visible ? 1 : 0,
  transition: 'opacity 0.2s ease-in-out',
  zIndex: 1,
  pointerEvents: visible ? 'auto' : 'none',

  '@media (prefers-reduced-motion: reduce)': {
    transition: 'none',
  },
}));

const ScrollbarThumb = styled(Box)<{
  height: number;
  top: number;
  isDragging: boolean;
}>(({ theme, height, top, isDragging }) => ({
  position: 'absolute',
  left: 0,
  top: `${top}px`,
  width: '100%',
  height: `${height}px`,
  backgroundColor:
    theme.palette.mode === 'dark'
      ? theme.palette.grey[600]
      : theme.palette.grey[400],
  borderRadius: '3px',
  cursor: isDragging ? 'grabbing' : 'grab',
  transition: isDragging
    ? 'background-color 0.15s ease'
    : 'top 0.1s ease-out, height 0.1s ease-out, background-color 0.15s ease',
  transform: 'translateZ(0)',
  willChange: isDragging ? 'top, height' : 'auto',

  '&:hover': {
    backgroundColor:
      theme.palette.mode === 'dark'
        ? theme.palette.grey[500]
        : theme.palette.grey[600],
  },

  '&:active': {
    backgroundColor:
      theme.palette.mode === 'dark'
        ? theme.palette.grey[400]
        : theme.palette.grey[700],
  },

  '@media (prefers-reduced-motion: reduce)': {
    transition: 'background-color 0.15s ease',
  },
}));

export const ScrollableContainer = forwardRef<
  HTMLDivElement,
  ScrollableContainerProps
>(({ children, className, sx }, ref) => {
  const {
    scrollbarState,
    containerRef,
    trackRef,
    thumbRef,
    handleMouseEnter,
    handleMouseLeave,
    handleTrackClick,
    handleThumbMouseDown,
    handleKeyDown,
  } = useScrollbar();

  return (
    <ScrollContainer
      ref={ref}
      className={className}
      sx={sx}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="region"
      aria-label="Scrollable sidebar content"
    >
      <ScrollContent ref={containerRef}>{children}</ScrollContent>

      {scrollbarState.isScrollable && (
        <ScrollbarTrack
          ref={trackRef}
          visible={scrollbarState.isVisible}
          onMouseDown={handleTrackClick}
          role="scrollbar"
          aria-orientation="vertical"
          aria-valuenow={Math.round(
            (scrollbarState.scrollTop /
              (scrollbarState.scrollHeight - scrollbarState.clientHeight)) *
              100,
          )}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Vertical scrollbar"
        >
          <ScrollbarThumb
            ref={thumbRef}
            height={scrollbarState.thumbHeight}
            top={scrollbarState.thumbTop}
            isDragging={scrollbarState.isDragging}
            onMouseDown={handleThumbMouseDown}
            role="button"
            aria-label="Scrollbar thumb"
            tabIndex={-1}
          />
        </ScrollbarTrack>
      )}
    </ScrollContainer>
  );
});

ScrollableContainer.displayName = 'ScrollableContainer';
