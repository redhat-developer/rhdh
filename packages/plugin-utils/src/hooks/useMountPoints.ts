import { useContext } from 'react';

import { DynamicRootContext } from '../context';

const useMountPoints = (mountPointId: string) => {
  const context = useContext(DynamicRootContext);

  // Check if context exists (consistent with your other hook)
  if (!context) {
    throw new Error(
      'useMountPoints must be used within a DynamicPluginProvider',
    );
  }

  const { mountPoints } = context;

  // Check if mountPointId is provided
  if (!mountPointId) {
    throw new Error('mountPointId is required');
  }

  // Check if mount point exists
  if (!mountPoints || !mountPoints[mountPointId]) {
    throw new Error(`Mount point "${mountPointId}" not found!`);
  }

  return mountPoints[mountPointId];
};

export default useMountPoints;
