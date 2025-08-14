import Box, { BoxProps } from '@mui/material/Box';
import { makeStyles } from 'tss-react/mui';

const useStyles = makeStyles()(theme => ({
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(12, 1fr)',
    gridGap: theme.spacing(3),
    gridAutoFlow: 'dense',
    alignItems: 'start',
  },
}));

const Grid = ({
  container = false,
  item = true,
  children,
  ...props
}: React.PropsWithChildren<
  { container?: boolean; item?: boolean } & BoxProps
>) => {
  const { classes } = useStyles();

  if (container) {
    return (
      <Box {...props} className={classes.grid}>
        {children}
      </Box>
    );
  }
  if (item) {
    return <Box {...props}>{children}</Box>;
  }
  return null;
};

export default Grid;
