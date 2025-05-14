import { useContext } from 'react';

import DynamicRootContext from '@internal/plugin-utils';

const useMountPoints = (mountPointId: string) => {
  const { mountPoints } = useContext(DynamicRootContext);
  if (!mountPoints[mountPointId])
    throw new Error(`Mount point ${mountPointId} not found!`);
  return mountPoints[mountPointId];
};

export default useMountPoints;
