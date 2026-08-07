import Box, { BoxProps } from '@mui/material/Box';
import type { CSSObject } from 'tss-react';
import { makeStyles } from 'tss-react/mui';

const BREAKPOINTS = {
  sm: 600,
  md: 900,
  lg: 1200,
  xl: 1536,
} as const;

type Breakpoint = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

type GridColumn = Partial<Record<Breakpoint, number | string>>;

function normalize(value?: number | string) {
  if (typeof value === 'number') return `span ${value}`;
  return value;
}

function extractGridColumn(sx: BoxProps['sx']): GridColumn | undefined {
  if (!sx || typeof sx !== 'object' || Array.isArray(sx)) return undefined;
  const gc = (sx as any).gridColumn;
  if (!gc || typeof gc !== 'object') return undefined;
  return gc;
}

function removeGridColumn(sx: BoxProps['sx']) {
  if (!sx || typeof sx !== 'object' || Array.isArray(sx)) return sx;
  const next = { ...(sx as any) };
  delete next.gridColumn;
  return next;
}

type StyleProps = {
  gridColumn: GridColumn;
};

const useStyles = makeStyles<StyleProps>()((theme, { gridColumn }) => {
  const item: CSSObject = {};

  // default xs behavior
  item.gridColumn = normalize(gridColumn.xs ?? '1 / -1');

  (Object.keys(BREAKPOINTS) as (keyof typeof BREAKPOINTS)[]).forEach(bp => {
    const value = gridColumn[bp];
    if (!value) return;

    item[`@container (min-width:${BREAKPOINTS[bp]}px)`] = {
      gridColumn: normalize(value),
    };
  });

  return {
    grid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(12, minmax(0,1fr))',
      gap: theme.spacing(3),
      gridAutoFlow: 'row',
      containerType: 'inline-size',
    },
    item,
  };
});

type GridProps = React.PropsWithChildren<
  {
    container?: boolean;
    item?: boolean;
  } & BoxProps
>;

const Grid = ({
  container = false,
  item = true,
  children,
  sx,
  ...props
}: GridProps) => {
  const gridColumn = extractGridColumn(sx) ?? {};

  const { classes, cx } = useStyles({ gridColumn });

  if (container) {
    return (
      <Box {...props} sx={sx} className={cx(classes.grid, props.className)}>
        {children}
      </Box>
    );
  }

  if (item) {
    const itemSx = removeGridColumn(sx);

    return (
      <Box {...props} sx={itemSx} className={cx(classes.item, props.className)}>
        {children}
      </Box>
    );
  }

  return null;
};

export default Grid;
