import { configApiRef, useApi } from '@backstage/core-plugin-api';

import Launch from '@mui/icons-material/Launch';
import Button from '@mui/material/Button';

import { useTranslation } from '../../../hooks/useTranslation';

export const ContactSupportButton = ({
  supportUrl,
}: {
  supportUrl?: string;
}) => {
  const configApi = useApi(configApiRef);
  const { t } = useTranslation();
  const finalSupportUrl =
    supportUrl ??
    configApi.getOptionalString('app.support.url') ??
    'https://access.redhat.com/documentation/red_hat_developer_hub';

  return (
    <Button
      variant="text"
      color="primary"
      component="a"
      href={finalSupportUrl}
      target="_blank"
      rel="noopener noreferrer"
      endIcon={<Launch />}
    >
      {t('app.errors.contactSupport')}
    </Button>
  );
};
