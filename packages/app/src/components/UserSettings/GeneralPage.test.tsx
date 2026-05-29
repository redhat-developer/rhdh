/*
 * Layer 3 component test mirroring part of the settings UI E2E spec (net
 * additive — the E2E spec is left in place). The RHDH-owned piece of the
 * settings page is GeneralPage, which composes the build-info card alongside
 * the upstream user-settings cards; this asserts that composition.
 */
import { configApiRef } from '@backstage/core-plugin-api';
import {
  mockApis,
  renderInTestApp,
  TestApiProvider,
} from '@backstage/frontend-test-utils';
import { catalogApiRef } from '@backstage/plugin-catalog-react';

import { screen } from '@testing-library/react';

import { GeneralPage } from './GeneralPage';

const catalogApiMock = {
  getEntities: jest.fn().mockResolvedValue({ items: [] }),
  getEntityByRef: jest.fn().mockResolvedValue(undefined),
} as unknown as typeof catalogApiRef.T;

describe('GeneralPage', () => {
  it('renders the build info card on the general settings page', async () => {
    await renderInTestApp(
      <TestApiProvider
        apis={[
          [configApiRef, mockApis.config({ data: { buildInfo: {} } })],
          [catalogApiRef, catalogApiMock],
        ]}
      >
        <GeneralPage />
      </TestApiProvider>,
    );

    expect(screen.getByText(/RHDH Version/)).toBeInTheDocument();
    expect(screen.getByText(/Backstage Version/)).toBeInTheDocument();
  });
});
