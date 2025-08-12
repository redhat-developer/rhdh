import React from 'react';

import {
  Content,
  Header,
  Page,
  TabbedLayout,
} from '@backstage/core-components';

import { useMountPoints } from '@red-hat-developer-hub/plugin-utils';

export interface PluginTab {
  Component: React.ComponentType;
  config: {
    path: string;
    title: string;
  };
}

export const DynamicPluginsInfoPage = () => {
  // this coercion is necessary to preserve compatability with
  // the original configuration definition
  const tabs = useMountPoints('internal.plugins/tab') as unknown as PluginTab[];
  const FirstComponent = tabs[0]?.Component;
  return (
    <Page themeId="extensions">
      <Header title="Extensions" />
      {tabs.length > 1 ? (
        <TabbedLayout>
          {tabs.map(({ Component, config }: PluginTab) => (
            <TabbedLayout.Route
              key={config.path}
              path={config.path}
              title={config.title}
            >
              <Component />
            </TabbedLayout.Route>
          ))}
        </TabbedLayout>
      ) : (
        <Content>
          <FirstComponent />
        </Content>
      )}
    </Page>
  );
};
