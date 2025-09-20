import { configApiRef } from '@backstage/core-plugin-api';
import {
  mockApis,
  renderInTestApp,
  TestApiProvider,
} from '@backstage/test-utils';

import { userEvent } from '@testing-library/user-event';

import { InfoCard } from './InfoCard';

describe('InfoCard', () => {
  it('should render essential versions by default', async () => {
    const mockConfig = mockApis.config({
      data: {
        buildInfo: {},
      },
    });
    const renderResult = await renderInTestApp(
      <TestApiProvider apis={[[configApiRef, mockConfig]]}>
        <InfoCard />
      </TestApiProvider>,
    );
    expect(renderResult.getByText(/RHDH Version/)).toBeInTheDocument();
    expect(renderResult.getByText(/Backstage Version/)).toBeInTheDocument();
  });

  it('should hide the build time by default and show it on click', async () => {
    const mockConfig = mockApis.config({
      data: {
        buildInfo: {},
      },
    });
    const renderResult = await renderInTestApp(
      <TestApiProvider apis={[[configApiRef, mockConfig]]}>
        <InfoCard />
      </TestApiProvider>,
    );
    expect(renderResult.queryByText(/Last Commit/)).toBeNull();
    await userEvent.click(renderResult.getByText(/RHDH Version/));
    expect(renderResult.getByText(/Last Commit/)).toBeInTheDocument();
  });

  it('should render the customized values when build info is configured', async () => {
    const mockConfig = mockApis.config({
      data: {
        buildInfo: {
          title: 'RHDH Build info',
          card: {
            'TechDocs builder': 'local',
            'Authentication provider': 'Github',
            RBAC: 'disabled',
          },
        },
      },
    });
    const renderResult = await renderInTestApp(
      <TestApiProvider apis={[[configApiRef, mockConfig]]}>
        <InfoCard />
      </TestApiProvider>,
    );
    expect(renderResult.queryByText(/TechDocs builder/)).toBeInTheDocument();
    expect(
      renderResult.queryByText(/Authentication provider/),
    ).toBeInTheDocument();
    await userEvent.click(renderResult.getByText(/TechDocs builder/));
    expect(renderResult.getByText(/RBAC/)).toBeInTheDocument();
    expect(renderResult.queryByText(/Last Commit/)).not.toBeInTheDocument();
  });

  it('should append the customized values along with RHDH versions when build info is configured with `full` set to false', async () => {
    const mockConfig = mockApis.config({
      data: {
        buildInfo: {
          title: 'RHDH Build info',
          card: {
            'TechDocs builder': 'local',
            'Authentication provider': 'Github',
            RBAC: 'disabled',
          },
          overrideBuildInfo: false,
        },
      },
    });
    const renderResult = await renderInTestApp(
      <TestApiProvider apis={[[configApiRef, mockConfig]]}>
        <InfoCard />
      </TestApiProvider>,
    );
    expect(renderResult.queryByText(/TechDocs builder/)).toBeInTheDocument();
    expect(
      renderResult.queryByText(/Authentication provider/),
    ).toBeInTheDocument();
    await userEvent.click(renderResult.getByText(/TechDocs builder/));
    expect(renderResult.getByText(/RBAC/)).toBeInTheDocument();
    expect(renderResult.queryByText(/Last Commit/)).toBeInTheDocument();
    expect(renderResult.queryByText(/RHDH Version/)).toBeInTheDocument();
  });

  it('should display only the customized values when build info is configured with full set to true, without appending RHDH versions', async () => {
    const mockConfig = mockApis.config({
      data: {
        buildInfo: {
          title: 'RHDH Build info',
          card: {
            'TechDocs builder': 'local',
            'Authentication provider': 'Github',
            RBAC: 'disabled',
          },
          overrideBuildInfo: true,
        },
      },
    });
    const renderResult = await renderInTestApp(
      <TestApiProvider apis={[[configApiRef, mockConfig]]}>
        <InfoCard />
      </TestApiProvider>,
    );
    expect(renderResult.queryByText(/TechDocs builder/)).toBeInTheDocument();
    expect(
      renderResult.queryByText(/Authentication provider/),
    ).toBeInTheDocument();
    await userEvent.click(renderResult.getByText(/TechDocs builder/));
    expect(renderResult.getByText(/RBAC/)).toBeInTheDocument();
    expect(renderResult.queryByText(/Last Commit/)).not.toBeInTheDocument();
  });

  it('should fallback to default json if the customized card value is empty', async () => {
    const mockConfig = mockApis.config({
      data: {
        buildInfo: {
          title: 'RHDH Build info',
          card: undefined,
        },
      },
    });
    const renderResult = await renderInTestApp(
      <TestApiProvider apis={[[configApiRef, mockConfig]]}>
        <InfoCard />
      </TestApiProvider>,
    );
    expect(
      renderResult.queryByText(/TechDocs builder/),
    ).not.toBeInTheDocument();
    expect(renderResult.getByText(/RHDH Version/)).toBeInTheDocument();
    expect(renderResult.getByText(/Backstage Version/)).toBeInTheDocument();
  });
});
