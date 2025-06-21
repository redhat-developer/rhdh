import { useEffect } from 'react';

import { useSystemThemedConfig } from '../../hooks/useThemedConfig';

const ConfigUpdater = () => {
  const logoIconBase64URI = useSystemThemedConfig('app.branding.iconLogo');

  useEffect(() => {
    if (logoIconBase64URI) {
      const favicon = document.getElementById(
        'dynamic-favicon',
      ) as HTMLLinkElement;

      if (favicon) {
        favicon.href = logoIconBase64URI;
      } else {
        const newFavicon = document.createElement('link');
        newFavicon.id = 'dynamic-favicon';
        newFavicon.rel = 'icon';
        newFavicon.href = logoIconBase64URI;
        document.head.appendChild(newFavicon);
      }
    }
  }, [logoIconBase64URI]);

  return null;
};

export default ConfigUpdater;
