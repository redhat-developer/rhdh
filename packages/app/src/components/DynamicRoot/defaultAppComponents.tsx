import { AppComponents } from '@backstage/core-plugin-api';

import { NotFoundErrorPage } from '../ErrorPages/NotFoundErrorPage';
import { SignInPage } from '../SignInPage/SignInPage';

const defaultAppComponents: Partial<AppComponents> = {
  SignInPage: props => <SignInPage {...props} />,
  NotFoundErrorPage: props => <NotFoundErrorPage {...props} />,
};

export default defaultAppComponents;
