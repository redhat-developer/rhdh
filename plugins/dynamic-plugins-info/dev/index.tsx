import { createDevApp } from '@backstage/dev-utils';
import { TestApiProvider } from '@backstage/test-utils';

import { listLoadedPluginsResult } from '../src/__fixtures__/listLoadedPluginsResult';
import { dynamicPluginsInfoApiRef } from '../src/api/types';
import { DynamicPluginsInfoContent } from '../src/components/DynamicPluginsInfoContent/DynamicPluginsInfoContent';
import { dynamicPluginsInfoPlugin } from '../src/plugin';

const mockedApi = {
  listLoadedPlugins: async () => {
    return listLoadedPluginsResult;
  },
};

createDevApp()
  .registerPlugin(dynamicPluginsInfoPlugin)
  .addPage({
    element: (
      <TestApiProvider apis={[[dynamicPluginsInfoApiRef, mockedApi]]}>
        <DynamicPluginsInfoContent />
      </TestApiProvider>
    ),
    title: 'Root Page',
    path: '/dynamic-plugins-info',
  })
  .render();
