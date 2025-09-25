import { BrowserRouter } from 'react-router-dom';

import { useSidebarOpenState } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';

import { render } from '@testing-library/react';

import { useAppBarThemedConfig } from '../../hooks/useThemedConfig';
import { useTranslation } from '../../hooks/useTranslation';
import { SidebarLogo } from './SidebarLogo';

jest.mock('@backstage/core-components', () => ({
  ...jest.requireActual('@backstage/core-components'),
  useSidebarOpenState: jest.fn(),
}));

jest.mock('@backstage/core-plugin-api', () => ({
  ...jest.requireActual('@backstage/core-plugin-api'),
  useApi: jest.fn(),
}));

jest.mock('../../hooks/useThemedConfig', () => ({
  ...jest.requireActual('../../hooks/useThemedConfig'),
  useAppBarThemedConfig: jest.fn(),
}));

jest.mock('../../hooks/useTranslation', () => ({
  useTranslation: jest.fn(),
}));

describe('SidebarLogo', () => {
  beforeEach(() => {
    // Mock translation function for all tests
    (useTranslation as any).mockReturnValue({
      t: jest.fn((key: string) => {
        const translations: Record<string, string> = {
          'sidebar.home': 'Home',
          'sidebar.homeLogo': 'Home logo',
        };
        return translations[key] || key;
      }),
    });
  });

  it('when sidebar is open renders the component with full logo base64 provided by config', () => {
    (useApi as any).mockReturnValue({
      getOptional: jest.fn().mockReturnValue('fullLogoWidth'),
    });
    (useAppBarThemedConfig as any).mockReturnValue('fullLogoBase64URI');

    (useSidebarOpenState as any).mockReturnValue({ isOpen: true });
    const { getByTestId } = render(
      <BrowserRouter>
        <SidebarLogo />
      </BrowserRouter>,
    );

    const fullLogo = getByTestId('home-logo');
    expect(fullLogo).toBeInTheDocument();
    expect(fullLogo).toHaveAttribute('src', 'fullLogoBase64URI');
    expect(fullLogo).toHaveAttribute('alt', 'Home logo');

    const logoLink = fullLogo.closest('a');
    expect(logoLink).toHaveAttribute('aria-label', 'Home');
  });

  it('when sidebar is open renders the component with default full logo if config is undefined', () => {
    (useApi as any).mockReturnValue({
      getOptional: jest.fn().mockReturnValue(undefined),
    });

    (useAppBarThemedConfig as any).mockReturnValue(undefined);

    (useSidebarOpenState as any).mockReturnValue({ isOpen: true });
    const { getByTestId } = render(
      <BrowserRouter>
        <SidebarLogo />
      </BrowserRouter>,
    );

    expect(getByTestId('default-full-logo')).toBeInTheDocument();
  });

  it('when sidebar is closed renders the component with icon logo base64 provided by config', () => {
    (useApi as any).mockReturnValue({
      getOptional: jest.fn().mockReturnValue('fullLogoWidth'),
    });
    (useAppBarThemedConfig as any).mockReturnValue('iconLogoBase64URI');

    (useSidebarOpenState as any).mockReturnValue({ isOpen: false });
    const { getByTestId } = render(
      <BrowserRouter>
        <SidebarLogo />
      </BrowserRouter>,
    );

    const fullLogo = getByTestId('home-logo');
    expect(fullLogo).toBeInTheDocument();
    expect(fullLogo).toHaveAttribute('src', 'iconLogoBase64URI');
    expect(fullLogo).toHaveAttribute('alt', 'Home logo');

    const logoLink = fullLogo.closest('a');
    expect(logoLink).toHaveAttribute('aria-label', 'Home');
  });

  it('when sidebar is closed renders the component with icon logo from default if not provided with config', () => {
    (useApi as any).mockReturnValue({
      getOptional: jest.fn().mockReturnValue(undefined),
    });

    (useAppBarThemedConfig as any).mockReturnValue(undefined);

    (useSidebarOpenState as any).mockReturnValue({ isOpen: false });
    const { getByTestId } = render(
      <BrowserRouter>
        <SidebarLogo />
      </BrowserRouter>,
    );

    expect(getByTestId('default-icon-logo')).toBeInTheDocument();
  });
});
