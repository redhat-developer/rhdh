import { useApp } from '@backstage/core-plugin-api';

import MuiIcon from '@mui/material/Icon';

export const MenuIcon = ({ icon }: { icon: string }) => {
  const app = useApp();
  if (!icon) {
    return null;
  }

  const SystemIcon = app.getSystemIcon(icon);

  if (SystemIcon) {
    return <SystemIcon fontSize="small" />;
  }

  if (icon.startsWith('<svg')) {
    const svgDataUri = `data:image/svg+xml;base64,${btoa(icon)}`;
    return (
      <MuiIcon style={{ fontSize: 20 }}>
        <img src={svgDataUri} alt="" />
      </MuiIcon>
    );
  }

  if (
    icon.startsWith('https://') ||
    icon.startsWith('http://') ||
    icon.startsWith('/')
  ) {
    return (
      <MuiIcon style={{ fontSize: 20 }} baseClassName="material-icons-outlined">
        <img src={icon} alt="" />
      </MuiIcon>
    );
  }

  return (
    <MuiIcon style={{ fontSize: 20 }} baseClassName="material-icons-outlined">
      {icon}
    </MuiIcon>
  );
};
