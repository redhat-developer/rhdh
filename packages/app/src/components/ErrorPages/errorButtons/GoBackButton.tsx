import { useNavigate } from 'react-router-dom';

import Button from '@mui/material/Button';

import { useTranslation } from '../../../hooks/useTranslation';

export const GoBackButton = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return window.history.length > 2 ? (
    <Button
      variant="outlined"
      color="primary"
      onClick={() => {
        navigate(-1);
      }}
    >
      {t('app.errors.goBack')}
    </Button>
  ) : null;
};
