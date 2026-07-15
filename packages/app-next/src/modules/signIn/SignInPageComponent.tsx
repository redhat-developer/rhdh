import { SignInPage } from '@backstage/core-components';
import { githubAuthApiRef } from '@backstage/core-plugin-api';
import type { SignInPageProps } from '@backstage/plugin-app-react';

const githubProvider = {
  id: 'github-auth-provider',
  title: 'GitHub',
  message: 'Sign in using GitHub',
  apiRef: githubAuthApiRef,
};

export function SignInPageComponent(props: SignInPageProps) {
  return <SignInPage {...props} auto providers={['guest', githubProvider]} />;
}
