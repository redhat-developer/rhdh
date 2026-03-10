import React from 'react';

import Box, { BoxProps } from '@mui/material/Box';
import type { CSSObject } from 'tss-react';
import { makeStyles } from 'tss-react/mui';

/** Container breakpoints aligned with MUI breakpoints */
const CONTAINER_BREAKPOINTS = {
  sm: 600,
  md: 900,
  lg: 1200,
  xl: 1536,
} as const;

const BREAKPOINT_KEYS = ['xs', 'sm', 'md', 'lg', 'xl'] as const;

export type GridColumn = Partial<
  Record<'xs' | 'sm' | 'md' | 'lg' | 'xl', string>
>;

/** Validate that object only contains breakpoint keys */
function isGridColumnBreakpoints(obj: unknown): obj is GridColumn {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return false;
  }

  return Object.keys(obj).every(k =>
    (BREAKPOINT_KEYS as readonly string[]).includes(k),
  );
}

/** Extract breakpoint-based gridColumn from sx */
function getGridColumnFromSx(sx: BoxProps['sx']): GridColumn | undefined {
  if (!sx || typeof sx !== 'object' || Array.isArray(sx)) {
    return undefined;
  }

  if (!('gridColumn' in sx)) {
    return undefined;
  }

  const gc = (sx as Record<string, unknown>).gridColumn;

  return isGridColumnBreakpoints(gc) ? gc : undefined;
}

/** Remove gridColumn from sx so MUI does not apply viewport media queries */
function sxWithoutGridColumn(sx: BoxProps['sx']): BoxProps['sx'] {
  if (!sx || typeof sx !== 'object' || Array.isArray(sx)) {
    return sx;
  }

  const rest = { ...(sx as Record<string, unknown>) };
  delete rest.gridColumn;

  return rest as BoxProps['sx'];
}

type StyleProps = {
  gridColumn: GridColumn;
};

const useStyles = makeStyles<StyleProps>()((theme, { gridColumn }) => {
  const itemStyles: CSSObject = {};

  /** Base rule should only come from xs */
  if (gridColumn?.xs) {
    itemStyles.gridColumn = gridColumn.xs;
  }

  if (gridColumn?.sm) {
    itemStyles[`@container (min-width: ${CONTAINER_BREAKPOINTS.sm}px)`] = {
      gridColumn: gridColumn.sm,
    };
  }

  if (gridColumn?.md) {
    itemStyles[`@container (min-width: ${CONTAINER_BREAKPOINTS.md}px)`] = {
      gridColumn: gridColumn.md,
    };
  }

  if (gridColumn?.lg) {
    itemStyles[`@container (min-width: ${CONTAINER_BREAKPOINTS.lg}px)`] = {
      gridColumn: gridColumn.lg,
    };
  }

  if (gridColumn?.xl) {
    itemStyles[`@container (min-width: ${CONTAINER_BREAKPOINTS.xl}px)`] = {
      gridColumn: gridColumn.xl,
    };
  }

  return {
    /** 12-column container grid */
    grid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(12, 1fr)',
      gap: theme.spacing(3),
      gridAutoFlow: 'dense',
      alignItems: 'start',
      containerType: 'inline-size', // enables container queries
    },

    /** Responsive item styles */
    item: itemStyles,
  };
});

type GridProps = React.PropsWithChildren<
  {
    container?: boolean;
    item?: boolean;
    /** Optional gridColumn prop; otherwise extracted from sx */
    gridColumn?: GridColumn;
  } & BoxProps
>;

/**
 * Custom grid using container queries instead of viewport media queries.
 */
const Grid = ({
  container = false,
  item = true,
  gridColumn: gridColumnProp,
  children,
  sx,
  ...props
}: GridProps) => {
  /** Determine responsive gridColumn configuration */
  const gridColumn = gridColumnProp ?? getGridColumnFromSx(sx) ?? {};

  const { classes, cx } = useStyles({ gridColumn });

  if (container) {
    return (
      <Box {...props} sx={sx} className={cx(classes.grid, props.className)}>
        {children}
      </Box>
    );
  }

  if (item) {
    const hasGridColumn = Object.values(gridColumn).some(Boolean);

    /** Remove gridColumn from sx so MUI doesn't apply viewport breakpoints */
    const itemSx: BoxProps['sx'] =
      hasGridColumn && sx ? sxWithoutGridColumn(sx) : sx;

    return (
      <Box
        {...props}
        sx={itemSx}
        className={cx(hasGridColumn && classes.item, props.className)}
      >
        {children}
      </Box>
    );
  }

  return null;
};

export default Grid;
