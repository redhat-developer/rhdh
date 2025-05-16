import { useNavigate } from 'react-router-dom';

import Button from '@mui/material/Button';

export const GoBackButton = () => {
  const navigate = useNavigate();

  return window.history.length > 2 ? (
    <Button
      variant="outlined"
      color="primary"
      onClick={() => {
        navigate(-1);
      }}
    >
      Go back
    </Button>
  ) : null;
};
