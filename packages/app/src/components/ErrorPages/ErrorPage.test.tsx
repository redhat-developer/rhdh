import { configApiRef } from '@backstage/core-plugin-api';
import {
  mockApis,
  renderInTestApp,
  TestApiProvider,
} from '@backstage/test-utils';

import { screen } from '@testing-library/react';

import { ErrorPage, ErrorPageProps } from './ErrorPage';

jest.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const renderErrorPage = async (props: ErrorPageProps) =>
  renderInTestApp(
    <TestApiProvider apis={[[configApiRef, mockApis.config({ data: {} })]]}>
      <ErrorPage {...props} />
    </TestApiProvider>,
  );

describe('ErrorPage', () => {
  it('renders the status, message and additional info', async () => {
    await renderErrorPage({
      status: '500',
      statusMessage: 'Internal Server Error',
      additionalInfo: 'Something went wrong',
    });

    expect(screen.getByText('500')).toBeInTheDocument();
    expect(screen.getByText('Internal Server Error')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('always offers the contact-support action', async () => {
    await renderErrorPage({ status: '500', statusMessage: 'Error' });

    expect(
      screen.getByRole('link', { name: 'app.errors.contactSupport' }),
    ).toBeInTheDocument();
  });

  it('renders the stack trace when one is provided', async () => {
    await renderErrorPage({
      status: '500',
      statusMessage: 'Error',
      stack: 'Error: boom\n  at foo',
    });

    expect(screen.getByText(/Error: boom/)).toBeInTheDocument();
  });

  it('omits the go-back action for non-404 errors', async () => {
    await renderErrorPage({ status: '500', statusMessage: 'Error' });

    expect(
      screen.queryByRole('button', { name: 'app.errors.goBack' }),
    ).not.toBeInTheDocument();
  });

  it('offers the go-back action for 404 errors when there is history', async () => {
    // GoBackButton only renders when there is meaningful history to go back to.
    Object.defineProperty(window.history, 'length', {
      value: 3,
      configurable: true,
    });

    await renderErrorPage({ status: '404', statusMessage: 'Not Found' });

    expect(
      screen.getByRole('button', { name: 'app.errors.goBack' }),
    ).toBeInTheDocument();
  });
});
