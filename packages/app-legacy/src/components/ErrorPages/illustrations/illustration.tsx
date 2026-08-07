import Box, { BoxProps } from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';

export const createIllustration = (
  light: string,
  dark: string,
  displayName?: string,
) => {
  const Illustration = (props: BoxProps<'img'>) => {
    const theme = useTheme();
    const isDarkMode = theme.palette.mode === 'dark';

    return (
      <Box
        component="img"
        src={isDarkMode ? dark : light}
        // presentational image
        alt=""
        aria-hidden="true"
        {...props}
      />
    );
  };

  Illustration.displayName = displayName || 'Illustration';

  return Illustration;
};
