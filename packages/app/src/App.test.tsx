import { lazy, Suspense } from 'react';

import { removeScalprum } from '@scalprum/core';
import { mockPluginData } from '@scalprum/react-test-utils';
import { render, waitFor } from '@testing-library/react';

import TestRoot from './utils/test/TestRoot';

const AppBase = lazy(() => import('./components/AppBase'));

describe('App', () => {
  beforeEach(() => {
    removeScalprum();
  });
  it('should render', async () => {
    const { TestScalprumProvider } = mockPluginData({}, {});
    process.env = {
      NODE_ENV: 'test',
      APP_CONFIG: [
        {
          data: {
            app: { title: 'Test' },
            backend: { baseUrl: 'http://localhost:7007' },
            auth: { environment: 'development' },
          },
          context: 'test',
        },
      ] as any,
    };

    const rendered = render(
      <TestScalprumProvider>
        <TestRoot>
          <Suspense fallback={null}>
            <AppBase />
          </Suspense>
        </TestRoot>
      </TestScalprumProvider>,
    );

    await waitFor(() => expect(rendered.baseElement).toBeInTheDocument());
  }, 100000);
});
