import type { AppComponents } from '@backstage/core-plugin-api';

import Button from '@material-ui/core/Button'; // workaround for broken-looking MUI5 button

import { ErrorPage } from './ErrorPage';

export const NotFoundErrorPage: AppComponents['NotFoundErrorPage'] = ({
  children,
}) => (
  <ErrorPage
    title={
      <>
        <strong>404</strong> We couldn't find that page
      </>
    }
    message={
      <>
        Try adding an <strong>index.md</strong> file in the root of the docs
        directory of this repository.
      </>
    }
    actions={
      <Button
        variant="outlined"
        color="primary"
        onClick={() => {
          window.history.back();
        }}
      >
        Go back
      </Button>
    }
  >
    {children}
  </ErrorPage>
);
