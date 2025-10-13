import GlobalStyles from '@mui/material/GlobalStyles';

import { apis } from './apis';
import ScalprumRoot from './components/DynamicRoot/ScalprumRoot';
import { DefaultMainMenuItems } from './consts';

// The base UI configuration, these values can be overridden by values
// specified in external configuration files
const baseFrontendConfig = {
  context: 'frontend',
  data: {
    dynamicPlugins: {
      frontend: {
        'default.main-menu-items': DefaultMainMenuItems,
      },
    },
  },
};

const AppRoot = () => (
  <>
    <GlobalStyles styles={{ html: { overflowY: 'hidden' } }} />
    <ScalprumRoot
      apis={apis}
      afterInit={() => import('./components/AppBase')}
      baseFrontendConfig={baseFrontendConfig}
    />
  </>
);

export default AppRoot;
