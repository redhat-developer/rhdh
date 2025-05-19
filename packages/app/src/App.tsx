import GlobalStyles from '@mui/material/GlobalStyles';

import { apis } from './apis';
import { StaticPlugins } from './components/DynamicRoot/DynamicRoot';
import ScalprumRoot from './components/DynamicRoot/ScalprumRoot';
import { DefaultMainMenuItems } from './consts';

// Statically integrated frontend plugins
const { dynamicPluginsInfoPlugin, ...dynamicPluginsInfoPluginModule } =
  await import('@internal/plugin-dynamic-plugins-info');

// The base UI configuration, these values can be overridden by values
// specified in external configuration files
const baseFrontendConfig = {
  context: 'frontend',
  data: {
    dynamicPlugins: {
      frontend: {
        'default.main-menu-items': DefaultMainMenuItems,
        // please keep this in sync with plugins/dynamic-plugins-info/app-config.janus-idp.yaml
        'internal.plugin-dynamic-plugins-info': {
          appIcons: [
            { name: 'pluginsInfoIcon', importName: 'PluginsInfoIcon' },
            { name: 'adminIcon', importName: 'AdminIcon' },
          ],
          dynamicRoutes: [
            {
              path: '/extensions',
              importName: 'DynamicPluginsInfoPage',
              menuItem: { text: 'Plugins', icon: 'pluginsInfoIcon' },
            },
          ],
          mountPoints: [
            {
              mountPoint: 'internal.plugins/tab',
              importName: 'DynamicPluginsInfoContent',
              config: {
                path: 'installed',
                title: 'Installed',
              },
            },
          ],
          menuItems: {
            admin: {
              title: 'Administration',
              icon: 'adminIcon',
            },
            extensions: {
              parent: 'admin',
              title: 'Extensions',
              icon: 'pluginsInfoIcon',
            },
          },
        },
      },
    },
  },
};

// The map of static plugins by package name
const staticPlugins: StaticPlugins = {
  'internal.plugin-dynamic-plugins-info': {
    plugin: dynamicPluginsInfoPlugin,
    module: dynamicPluginsInfoPluginModule,
  },
};

const AppRoot = () => (
  <>
    <GlobalStyles styles={{ html: { overflowY: 'hidden' } }} />
    <ScalprumRoot
      apis={apis}
      afterInit={() => import('./components/AppBase')}
      baseFrontendConfig={baseFrontendConfig}
      plugins={staticPlugins}
    />
  </>
);

export default AppRoot;
