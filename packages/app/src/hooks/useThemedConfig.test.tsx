/*
 * Layer 3 component test mirroring the behavior of the custom-theme UI E2E
 * spec (net additive — the E2E spec is left in place). Covers how branding
 * assets and sidebar styling are selected from config and the active theme.
 */
import { PropsWithChildren } from 'react';

import { configApiRef } from '@backstage/core-plugin-api';
import { mockApis, TestApiProvider } from '@backstage/frontend-test-utils';

import { createTheme, ThemeOptions, ThemeProvider } from '@mui/material/styles';
import { renderHook } from '@testing-library/react';

import {
  useAppBarBackgroundScheme,
  useAppBarThemedConfig,
  useSidebarSelectedBackgroundColor,
  useSystemThemedConfig,
} from './useThemedConfig';

const themeWith = (rhdhGeneral?: object) =>
  createTheme(
    rhdhGeneral
      ? ({
          palette: { rhdh: { general: rhdhGeneral } },
        } as unknown as ThemeOptions)
      : {},
  );

const themeWrapper =
  (rhdhGeneral?: object) =>
  ({ children }: PropsWithChildren) => (
    <ThemeProvider theme={themeWith(rhdhGeneral)}>{children}</ThemeProvider>
  );

const configWrapper =
  (brandingData: object) =>
  ({ children }: PropsWithChildren) => (
    <TestApiProvider
      apis={[[configApiRef, mockApis.config({ data: brandingData })]]}
    >
      {children}
    </TestApiProvider>
  );

const makeWrapper = (rhdhGeneral: object | undefined, brandingData: object) => {
  const theme = themeWith(rhdhGeneral);
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
      wrapper: makeWrapper({ appBarBackgroundScheme: 'light' }, {}),
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
        wrapper: makeWrapper(
          { appBarBackgroundScheme: 'light' },
          { app: { branding: { fullLogo: 'logo.svg' } } },
        ),
      },
    );

    expect(result.current).toEqual('logo.svg');
  });

  it('selects the branding variant matching the app-bar scheme', () => {
    const { result } = renderHook(
      () => useAppBarThemedConfig('app.branding.fullLogo'),
      {
        wrapper: makeWrapper(
          { appBarBackgroundScheme: 'dark' },
          {
            app: {
              branding: {
                fullLogo: { light: 'logo-light.svg', dark: 'logo-dark.svg' },
              },
            },
          },
        ),
      },
    );

    expect(result.current).toEqual('logo-dark.svg');
  });
});

describe('useSidebarSelectedBackgroundColor', () => {
  it('returns the sidebar selected background color from the theme', () => {
    const { result } = renderHook(() => useSidebarSelectedBackgroundColor(), {
      wrapper: themeWrapper({ sidebarItemSelectedBackgroundColor: '#abcdef' }),
    });

    expect(result.current).toEqual('#abcdef');
  });

  it("defaults to '' when the theme does not set the color", () => {
    const { result } = renderHook(() => useSidebarSelectedBackgroundColor(), {
      wrapper: themeWrapper(),
    });

    expect(result.current).toEqual('');
  });
});

describe('useSystemThemedConfig', () => {
  const originalMatchMedia = window.matchMedia;

  const mockPrefersDark = (prefersDark: boolean) => {
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
      matches: prefersDark,
      media: query,
      onchange: null,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));
  };

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('selects the branding variant matching the system color scheme', () => {
    mockPrefersDark(true);

    const { result } = renderHook(
      () => useSystemThemedConfig('app.branding.fullLogo'),
      {
        wrapper: configWrapper({
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

  it('returns a string branding asset unchanged regardless of scheme', () => {
    mockPrefersDark(false);

    const { result } = renderHook(
      () => useSystemThemedConfig('app.branding.fullLogo'),
      {
        wrapper: configWrapper({ app: { branding: { fullLogo: 'logo.svg' } } }),
      },
    );

    expect(result.current).toEqual('logo.svg');
  });
});
