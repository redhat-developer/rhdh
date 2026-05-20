import { configApiRef } from '@backstage/core-plugin-api';
import {
  mockApis,
  renderInTestApp,
  TestApiProvider,
} from '@backstage/test-utils';

import { screen } from '@testing-library/react';

import { SignInPage } from './SignInPage';

jest.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Stub the heavy core-components sign-in widgets so the test isolates this
// component's own provider-selection logic (which providers / proxied vs local).
jest.mock('@backstage/core-components', () => ({
  ...jest.requireActual('@backstage/core-components'),
  SignInPage: (props: { providers: (string | { id: string })[] }) => (
    <div
      data-testid="cc-signin"
      data-providers={props.providers
        .map(provider =>
          typeof provider === 'string' ? provider : provider.id,
        )
        .join(',')}
    />
  ),
  ProxiedSignInPage: (props: { provider: string }) => (
    <div data-testid="proxied-signin" data-provider={props.provider} />
  ),
}));

const renderSignIn = async (data: object) =>
  renderInTestApp(
    <TestApiProvider apis={[[configApiRef, mockApis.config({ data })]]}>
      <SignInPage onSignInSuccess={jest.fn()} />
    </TestApiProvider>,
  );

describe('SignInPage', () => {
  it('renders a proxied sign-in page for a proxy provider', async () => {
    await renderSignIn({
      auth: { environment: 'production' },
      signInPage: 'oauth2Proxy',
    });

    expect(screen.getByTestId('proxied-signin')).toHaveAttribute(
      'data-provider',
      'oauth2Proxy',
    );
  });

  it('prepends the guest provider in a development environment', async () => {
    await renderSignIn({
      auth: { environment: 'development' },
      signInPage: 'github',
    });

    expect(screen.getByTestId('cc-signin')).toHaveAttribute(
      'data-providers',
      'guest,github-auth-provider',
    );
  });

  it('omits guest in production and defaults to github when unset', async () => {
    await renderSignIn({ auth: { environment: 'production' } });

    expect(screen.getByTestId('cc-signin')).toHaveAttribute(
      'data-providers',
      'github-auth-provider',
    );
  });

  it('falls back to the default provider when configured providers are unknown', async () => {
    await renderSignIn({
      auth: { environment: 'production' },
      signInPage: ['does-not-exist'],
    });

    expect(screen.getByTestId('cc-signin')).toHaveAttribute(
      'data-providers',
      'github-auth-provider',
    );
  });
});
