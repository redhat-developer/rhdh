import React from 'react';

import {
  Content,
  Header,
  Page,
  TabbedLayout,
} from '@backstage/core-components';

import { useScalprum } from '@scalprum/react-core';

export interface PluginTab {
  Component: React.ComponentType;
  config: {
    path: string;
    title: string;
  };
}

export interface ScalprumState {
  api?: {
    dynamicRootConfig?: {
      mountPoints?: {
        'internal.plugins/tab': PluginTab[];
      };
    };
  };
}

export const DynamicPluginsInfoPage = () => {
  const scalprum = useScalprum<ScalprumState>();

  const tabs =
    scalprum.api?.dynamicRootConfig?.mountPoints?.['internal.plugins/tab'] ||
    [];

  const FirstComponent = tabs[0]?.Component;

  return (
    <Page themeId="extensions">
      <Header title="Extensions" />
      {tabs.length > 1 ? (
        <TabbedLayout>
          {tabs.map(({ Component, config }) => (
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
