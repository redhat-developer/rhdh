/*
 * Layer 3 component test mirroring part of the behavior of the sidebar UI E2E
 * spec (net additive — the E2E spec is left in place). Covers that a custom
 * sidebar item renders its label and links to the configured target.
 */
import { renderInTestApp } from '@backstage/frontend-test-utils';

import HomeIcon from '@mui/icons-material/Home';
import { screen } from '@testing-library/react';

import { CustomSidebarItem } from './CustomSidebarItem';

describe('CustomSidebarItem', () => {
  it('renders the label and links to the configured target', async () => {
    await renderInTestApp(
      <CustomSidebarItem icon={HomeIcon} to="/catalog" text="Catalog" />,
    );

    const link = screen.getByRole('link', { name: /Catalog/ });
    expect(link).toHaveAttribute('href', '/catalog');
  });

  it('renders distinct items for distinct targets', async () => {
    await renderInTestApp(
      <>
        <CustomSidebarItem icon={HomeIcon} to="/catalog" text="Catalog" />
        <CustomSidebarItem icon={HomeIcon} to="/docs" text="Docs" />
      </>,
    );

    expect(screen.getByRole('link', { name: /Catalog/ })).toHaveAttribute(
      'href',
      '/catalog',
    );
    expect(screen.getByRole('link', { name: /Docs/ })).toHaveAttribute(
      'href',
      '/docs',
    );
  });

  it('injects global styling for built-in sidebar items', async () => {
    await renderInTestApp(
      <CustomSidebarItem icon={HomeIcon} to="/catalog" text="Catalog" />,
    );

    const injectedStyles = Array.from(document.head.querySelectorAll('style'));
    expect(
      injectedStyles.some(style =>
        style.textContent?.includes('BackstageSidebarItem-selected'),
      ),
    ).toBe(true);
  });
});
