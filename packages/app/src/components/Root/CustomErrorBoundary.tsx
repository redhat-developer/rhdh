import React, { Component, ComponentClass, ErrorInfo } from 'react';

type State = {
  error?: Error;
  errorInfo?: ErrorInfo;
};

/** @public */
export type CustomErrorBoundaryProps = React.PropsWithChildren<{
  onError?: (error: Error, errorInfo: string) => null;
  fallback?: React.ReactNode;
}>;

/** @public */
export const CustomErrorBoundary: ComponentClass<
  CustomErrorBoundaryProps,
  State
> = class CustomErrorBoundary extends Component<
  CustomErrorBoundaryProps,
  State
> {
  constructor(props: CustomErrorBoundaryProps) {
    super(props);
    this.state = {
      error: undefined,
      errorInfo: undefined,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error(`ErrorBoundary, error: ${error}`, { error, errorInfo });
    this.setState({ error, errorInfo });
  }

  render() {
    const { children, fallback } = this.props;
    const { error } = this.state;

    if (error) {
      return fallback;
    }

    return children;
  }
};
