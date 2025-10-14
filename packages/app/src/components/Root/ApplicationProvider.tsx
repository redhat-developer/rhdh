import {
  Component,
  ComponentType,
  ErrorInfo,
  PropsWithChildren,
  ReactNode,
  useContext,
  useMemo,
} from 'react';

import { ErrorPanel } from '@backstage/core-components';

import DynamicRootContext from '@red-hat-developer-hub/plugin-utils';

class ErrorBoundary extends Component<
  {
    Component: ComponentType<{ children?: ReactNode }>;
    children: ReactNode;
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
    console.error(`Error in application/provider ${name}: ${error.message}`, {
      error,
      errorInfo,
      Component: Comp,
    });
  }

  render() {
    const { Component: Comp, children } = this.props;
    const { error } = this.state;
    if (error) {
      const name = Comp.displayName ?? Comp.name ?? 'Component';
      const title = `Error in application/provider ${name}: ${error.message}`;
      return (
        <>
          <ErrorPanel title={title} error={error} />
          {children}
        </>
      );
    }
    return <Comp>{children}</Comp>;
  }
}

export const ApplicationProvider = ({ children }: PropsWithChildren<{}>) => {
  const { mountPoints } = useContext(DynamicRootContext);
  const providers = useMemo(
    () => mountPoints['application/provider'] ?? [],
    [mountPoints],
  );
  if (providers.length === 0) {
    return children;
  }
  return providers.reduceRight((acc, { Component: Comp }, index) => {
    return (
      <ErrorBoundary
        // eslint-disable-next-line react/no-array-index-key
        key={index}
        Component={Comp}
      >
        {acc}
      </ErrorBoundary>
    );
  }, children);
};
