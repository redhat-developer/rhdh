import { configApiRef, useApi } from '@backstage/core-plugin-api';

import Launch from '@mui/icons-material/Launch';
import Button from '@mui/material/Button';

export const ContactSupportButton = () => {
  const configApi = useApi(configApiRef);
  const supportUrl =
    configApi.getOptionalString('app.support.url') ??
    'https://access.redhat.com/documentation/red_hat_developer_hub';

  return (
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
  );
};
