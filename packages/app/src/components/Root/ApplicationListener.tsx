import { Component, ComponentType, ErrorInfo, useContext } from 'react';

import { ErrorPanel } from '@backstage/core-components';

import DynamicRootContext from '@red-hat-developer-hub/plugin-utils';

class ErrorBoundary extends Component<
  {
    Component: ComponentType<{}>;
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
    const { Component: Comp } = this.props;
    const name = Comp.displayName ?? Comp.name ?? 'Component';
    // eslint-disable-next-line no-console
    console.error(`Error in application/listener ${name}: ${error.message}`, {
      error,
      errorInfo,
      Component: Comp,
    });
  }

  render() {
    const { Component: Comp } = this.props;
    const { error } = this.state;
    if (error) {
      const name = Comp.displayName ?? Comp.name ?? 'Component';
      const title = `Error in application/listener ${name}: ${error.message}`;
      return <ErrorPanel title={title} error={error} />;
    }
    return <Comp />;
  }
}

export const ApplicationListener = () => {
  const { mountPoints } = useContext(DynamicRootContext);
  const listeners = mountPoints['application/listener'] ?? [];
  return listeners.map(({ Component: Comp }, index) => {
    return (
      <ErrorBoundary
        // eslint-disable-next-line react/no-array-index-key
        key={index}
        Component={Comp}
      />
    );
  });
};
