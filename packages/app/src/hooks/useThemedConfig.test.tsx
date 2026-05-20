/*
 * Layer 3 component test mirroring the behavior of the custom-theme UI E2E
 * spec (net new — the E2E spec is left in place). Covers how branding assets
 * are selected from config based on the active app-bar theme scheme.
 */
import { PropsWithChildren } from 'react';

import { configApiRef } from '@backstage/core-plugin-api';
import { mockApis, TestApiProvider } from '@backstage/test-utils';

import { createTheme, ThemeProvider } from '@mui/material/styles';
import { renderHook } from '@testing-library/react';

import {
  useAppBarBackgroundScheme,
  useAppBarThemedConfig,
} from './useThemedConfig';

const makeWrapper = (
  appBarBackgroundScheme: string | undefined,
  brandingData: object,
) => {
  const theme = createTheme(
    appBarBackgroundScheme
      ? ({ palette: { rhdh: { general: { appBarBackgroundScheme } } } } as any)
      : {},
  );
  const configApi = mockApis.config({ data: brandingData });

  return ({ children }: PropsWithChildren) => (
    <ThemeProvider theme={theme}>
      <TestApiProvider apis={[[configApiRef, configApi]]}>
        {children}
      </TestApiProvider>
    </ThemeProvider>
  );
};

describe('useAppBarBackgroundScheme', () => {
  it('returns the scheme configured on the theme palette', () => {
    const { result } = renderHook(() => useAppBarBackgroundScheme(), {
      wrapper: makeWrapper('light', {}),
    });

    expect(result.current).toEqual('light');
  });

  it("defaults to 'dark' when the theme does not set a scheme", () => {
    const { result } = renderHook(() => useAppBarBackgroundScheme(), {
      wrapper: makeWrapper(undefined, {}),
    });

    expect(result.current).toEqual('dark');
  });
});

describe('useAppBarThemedConfig', () => {
  it('returns a string branding asset unchanged', () => {
    const { result } = renderHook(
      () => useAppBarThemedConfig('app.branding.fullLogo'),
      {
        wrapper: makeWrapper('light', {
          app: { branding: { fullLogo: 'logo.svg' } },
        }),
      },
    );

    expect(result.current).toEqual('logo.svg');
  });

  it('selects the branding variant matching the app-bar scheme', () => {
    const { result } = renderHook(
      () => useAppBarThemedConfig('app.branding.fullLogo'),
      {
        wrapper: makeWrapper('dark', {
          app: {
            branding: {
              fullLogo: { light: 'logo-light.svg', dark: 'logo-dark.svg' },
            },
          },
        }),
      },
    );

    expect(result.current).toEqual('logo-dark.svg');
  });
});
