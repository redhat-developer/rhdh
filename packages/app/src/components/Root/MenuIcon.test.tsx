import { useApp } from '@backstage/core-plugin-api';

import { render, screen } from '@testing-library/react';

import { MenuIcon } from './MenuIcon';

jest.mock('@backstage/core-plugin-api', () => ({
  ...jest.requireActual('@backstage/core-plugin-api'),
  useApp: jest.fn(),
}));

const mockGetSystemIcon = jest.fn();

beforeEach(() => {
  mockGetSystemIcon.mockReset();
  (useApp as jest.Mock).mockReturnValue({ getSystemIcon: mockGetSystemIcon });
});

describe('MenuIcon', () => {
  it('renders nothing when the icon is empty', () => {
    const { container } = render(<MenuIcon icon="" />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders the registered system icon when one matches', () => {
    const SystemIcon = () => <svg data-testid="system-icon" />;
    mockGetSystemIcon.mockReturnValue(SystemIcon);

    render(<MenuIcon icon="user" />);

    expect(screen.getByTestId('system-icon')).toBeInTheDocument();
  });

  it('renders an inline SVG icon as a base64 image', () => {
    mockGetSystemIcon.mockReturnValue(undefined);

    const { container } = render(<MenuIcon icon="<svg></svg>" />);

    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      expect.stringContaining('data:image/svg+xml;base64,'),
    );
  });

  it('renders a URL icon using the URL as the image source', () => {
    mockGetSystemIcon.mockReturnValue(undefined);

    const { container } = render(
      <MenuIcon icon="https://example.com/icon.png" />,
    );

    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      'https://example.com/icon.png',
    );
  });

  it('renders a material icon name as text', () => {
    mockGetSystemIcon.mockReturnValue(undefined);

    render(<MenuIcon icon="home" />);

    expect(screen.getByText('home')).toBeInTheDocument();
  });
});
