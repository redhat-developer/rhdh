import React, { Component, ComponentClass, ErrorInfo } from 'react';

type State = {
  errorOccurred?: boolean;
};

/** @public */
export type CustomErrorBoundaryProps = React.PropsWithChildren<{
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
  static getDerivedStateFromError(_error: Error) {
    return { errorOccurred: true };
  }
  constructor(props: CustomErrorBoundaryProps) {
    super(props);
    this.state = {
      errorOccurred: false,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary', { error, errorInfo });
  }

  render() {
    const { children, fallback } = this.props;
    const { errorOccurred } = this.state;

    if (errorOccurred) {
      return fallback;
    }

    return children;
  }
};
