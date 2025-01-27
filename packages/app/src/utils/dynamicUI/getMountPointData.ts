import { getScalprum } from '@scalprum/core';

import { ScalprumMountPointConfig } from '../../components/DynamicRoot/DynamicRootContext';

function getMountPointData<T = any, T2 = any>(
  mountPoint: string,
): {
  config: ScalprumMountPointConfig;
  Component: T;
  staticJSXContent: T2;
}[] {
  return getScalprum().api.dynamicRootConfig?.mountPoints?.[mountPoint] ?? [];
}

export default getMountPointData;
