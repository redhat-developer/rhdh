import React, { useContext } from 'react';

import { ErrorBoundary } from '@backstage/core-components';

import DynamicRootContext from '../DynamicRoot/DynamicRootContext';

export const ApplicationHeaders = ({ position }: { position: string }) => {
  const { mountPoints } = useContext(DynamicRootContext);
  const appHeaderMountPoints = mountPoints['application/header'] ?? [];
  return appHeaderMountPoints
    ?.filter(({ config }) => config?.layout?.position === position)
    .map(({ Component, config }, index) => (
      // eslint-disable-next-line react/no-array-index-key
      <ErrorBoundary key={index}>
        <Component {...config?.props} />
      </ErrorBoundary>
    ));
};
