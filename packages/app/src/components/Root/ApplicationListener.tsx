import { useContext } from 'react';

import DynamicRootContext from '../DynamicRoot/DynamicRootContext';
import { CustomErrorBoundary } from './CustomErrorBoundary';

export const ApplicationListener = () => {
  const { mountPoints } = useContext(DynamicRootContext);
  const listeners = mountPoints['application/listener'] ?? [];
  return listeners.map(({ Component }, index) => {
    return (
      <CustomErrorBoundary
        // eslint-disable-next-line react/no-array-index-key
        key={index}
      >
        <Component />
      </CustomErrorBoundary>
    );
  });
};
