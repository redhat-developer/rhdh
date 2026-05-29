/*
 * Layer 3 component test mirroring the behavior of the UI E2E spec
 * e2e-tests/playwright/e2e/learning-path-page.spec.ts (net new — the E2E spec
 * is intentionally left in place).
 */
import {
  renderInTestApp,
  TestApiProvider,
} from '@backstage/frontend-test-utils';
import { searchApiRef } from '@backstage/plugin-search-react';

import { screen } from '@testing-library/react';

import { useLearningPathData } from '../../hooks/useLearningPathData';
import { LearningPaths } from './LearningPathsPage';

jest.mock('../../hooks/useLearningPathData');

jest.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockUseLearningPathData = useLearningPathData as jest.Mock;

const searchApiMock = { query: jest.fn().mockResolvedValue({ results: [] }) };

const renderPage = () =>
  renderInTestApp(
    <TestApiProvider apis={[[searchApiRef, searchApiMock]]}>
      <LearningPaths />
    </TestApiProvider>,
  );

describe('LearningPaths', () => {
  // clearAllMocks (not resetAllMocks) so the module-scoped searchApiMock keeps
  // its resolved implementation across tests; only call history is cleared.
  afterEach(() => jest.clearAllMocks());

  it('shows a progress indicator while loading', async () => {
    mockUseLearningPathData.mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: true,
    });

    await renderPage();

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('renders a card with an external link for each learning path', async () => {
    mockUseLearningPathData.mockReturnValue({
      data: [
        {
          label: 'Building Operators on OpenShift',
          description: 'Learn about k8s API fundamentals',
          url: 'https://developers.redhat.com/learn/openshift/operators',
          hours: 1,
          minutes: 20,
          paths: 6,
        },
      ],
      error: undefined,
      isLoading: false,
    });

    await renderPage();

    expect(
      screen.getByText('Building Operators on OpenShift'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Learn about k8s API fundamentals'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('1 hour 20 minutes | 6 learning paths'),
    ).toBeInTheDocument();

    const link = screen.getByRole('link', {
      name: /Building Operators on OpenShift/,
    });
    expect(link).toHaveAttribute(
      'href',
      'https://developers.redhat.com/learn/openshift/operators',
    );
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('shows an error report when no learning paths are returned', async () => {
    mockUseLearningPathData.mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: false,
    });

    await renderPage();

    expect(
      screen.getByText(/app\.learningPaths\.error\.title/),
    ).toBeInTheDocument();
  });

  it('shows the underlying error message when loading fails', async () => {
    mockUseLearningPathData.mockReturnValue({
      data: undefined,
      error: new Error('Boom'),
      isLoading: false,
    });

    await renderPage();

    expect(screen.getByText(/Error: Boom/)).toBeInTheDocument();
  });
});
