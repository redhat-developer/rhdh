import { useContext, useMemo } from 'react';

import DynamicRootContext from '../DynamicRoot/DynamicRootContext';
import { CustomErrorBoundary } from './CustomErrorBoundary';

export const ApplicationProvider = ({
  children,
}: React.PropsWithChildren<{}>) => {
  const { mountPoints } = useContext(DynamicRootContext);
  const providers = useMemo(
    () => mountPoints['application/provider'] ?? [],
    [mountPoints],
  );
  if (!providers || providers.length === 0) {
    return children;
  }
  return providers.reduceRight((acc, { Component }, index) => {
    return (
      <CustomErrorBoundary
        // eslint-disable-next-line react/no-array-index-key
        key={index}
        fallback={acc}
      >
        <Component>{acc}</Component>
      </CustomErrorBoundary>
    );
  }, children);
};
