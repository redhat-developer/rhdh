import React from 'react';

import Box, { BoxProps } from '@mui/material/Box';
import { makeStyles } from 'tss-react/mui';

type StyleProps = { stackWidth: number };

const useStyles = makeStyles<StyleProps>()((theme, { stackWidth }) => ({
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(12, 1fr)',
    gap: theme.spacing(3),
    gridAutoFlow: 'dense',
    alignItems: 'start',
    containerType: 'inline-size',
  },
  item: {
    [`@container (max-width: ${stackWidth}px)`]: {
      gridColumn: '1 / -1',
    },
  },
}));

type GridProps = React.PropsWithChildren<
  {
    container?: boolean;
    item?: boolean;
    /** Breakpoint (px) below which items stack full width. Default 850. */
    stackWidth?: number;
  } & BoxProps
>;

/** 12-column responsive grid; items stack full width below stackWidth. */
const Grid = ({
  container = false,
  item = true,
  stackWidth = 850,
  children,
  ...props
}: GridProps) => {
  const { classes, cx } = useStyles({ stackWidth });

  if (container) {
    return (
      <Box {...props} className={cx(classes.grid, props.className)}>
        {children}
      </Box>
    );
  }

  if (item) {
    return (
      <Box {...props} className={cx(classes.item, props.className)}>
        {children}
      </Box>
    );
  }

  return null;
};

export default Grid;
