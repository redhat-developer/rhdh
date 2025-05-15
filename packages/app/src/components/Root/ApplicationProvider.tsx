import React, { ErrorInfo } from 'react';

import { ErrorPanel } from '@backstage/core-components';

import DynamicRootContext from '@red-hat-developer-hub/plugin-utils';

class ErrorBoundary extends React.Component<
  {
    Component: React.ComponentType<{ children?: React.ReactNode }>;
    children: React.ReactNode;
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
    console.error(`Error in application/provider ${name}: ${error.message}`, {
      error,
      errorInfo,
      Component,
    });
  }

  render() {
    const { Component, children } = this.props;
    const { error } = this.state;
    if (error) {
      const name = Component.displayName ?? Component.name ?? 'Component';
      const title = `Error in application/provider ${name}: ${error.message}`;
      return (
        <>
          <ErrorPanel title={title} error={error} />
          {children}
        </>
      );
    }
    return <Component>{children}</Component>;
  }
}

export const ApplicationProvider = ({
  children,
}: React.PropsWithChildren<{}>) => {
  const { mountPoints } = React.useContext(DynamicRootContext);
  const providers = React.useMemo(
    () => mountPoints['application/provider'] ?? [],
    [mountPoints],
  );
  if (providers.length === 0) {
    return children;
  }
  return providers.reduceRight((acc, { Component }, index) => {
    return (
      <ErrorBoundary
        // eslint-disable-next-line react/no-array-index-key
        key={index}
        Component={Component}
      >
        {acc}
      </ErrorBoundary>
    );
  }, children);
};
