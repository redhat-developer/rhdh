import React, { ErrorInfo, useContext } from 'react';

import { ErrorPanel } from '@backstage/core-components';

import DynamicRootContext from '@red-hat-developer-hub/plugin-utils';

class ErrorBoundary extends React.Component<
  {
    Component: React.ComponentType<{}>;
  },
  { error: any }
> {
  static getDerivedStateFromError(error: any) {
    return { error };
  }

  constructor(props: any) {
    super(props);
    this.state = { error: null };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const { Component } = this.props;
    const name = Component.displayName ?? Component.name ?? 'Component';
    // eslint-disable-next-line no-console
    console.error(`Error in application/listener ${name}: ${error.message}`, {
      error,
      errorInfo,
      Component,
    });
  }

  render() {
    const { Component } = this.props;
    const { error } = this.state;
    if (error) {
      const name = Component.displayName ?? Component.name ?? 'Component';
      const title = `Error in application/listener ${name}: ${error.message}`;
      return <ErrorPanel title={title} error={error} />;
    }
    return <Component />;
  }
}

export const ApplicationListener = () => {
  const { mountPoints } = useContext(DynamicRootContext);
  const listeners = mountPoints['application/listener'] ?? [];
  return listeners.map(({ Component }, index) => {
    return (
      <ErrorBoundary
        // eslint-disable-next-line react/no-array-index-key
        key={index}
        Component={Component}
      />
    );
  });
};
