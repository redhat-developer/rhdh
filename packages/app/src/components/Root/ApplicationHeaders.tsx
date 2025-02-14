import React, { useContext, useMemo } from 'react';

import { ErrorBoundary } from '@backstage/core-components';

import DynamicRootContext, {
  ScalprumMountPoint,
  ScalprumMountPointConfigBase,
} from '../DynamicRoot/DynamicRootContext';

type Position = 'above-main-content' | 'above-sidebar';

type ApplicationHeaderMountPointConfig = ScalprumMountPointConfigBase & {
  position: Position;
};

type ApplicationHeaderMountPoint = ScalprumMountPoint & {
  Component: React.ComponentType<
    React.PropsWithChildren<{ position: Position }>
  >;
  config?: ApplicationHeaderMountPointConfig;
};

export const ApplicationHeaders = ({ position }: { position: Position }) => {
  const { mountPoints } = useContext(DynamicRootContext);

  const appHeaderMountPoints = useMemo(() => {
    const appHeaderMP = (mountPoints['application/header'] ??
      []) as ApplicationHeaderMountPoint[];

    return appHeaderMP.filter(
      ({ config }) =>
        config?.position === position || config?.layout?.position === position,
    );
  }, [mountPoints, position]);

  return appHeaderMountPoints.map(({ Component, config }, index) => (
    // eslint-disable-next-line react/no-array-index-key
    <ErrorBoundary key={index}>
      <Component position={position} {...config?.props} />
    </ErrorBoundary>
  ));
};
