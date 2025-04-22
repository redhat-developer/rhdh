import { configApiRef, useApi } from '@backstage/core-plugin-api';

import Launch from '@mui/icons-material/Launch';
import Button from '@mui/material/Button';

export const ContactSupportButton = () => {
  const configApi = useApi(configApiRef);
  const supportUrl = configApi.getOptionalString('app.support.url');

  return supportUrl ? (
    <Button
      variant="text"
      color="primary"
      component="a"
      href={supportUrl}
      target="_blank"
      rel="noopener noreferrer"
      endIcon={<Launch />}
    >
      Contact support
    </Button>
  ) : null;
};
