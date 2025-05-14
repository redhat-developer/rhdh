import { getScalprum } from '@scalprum/core';

import { MountPointConfig } from '@internal/plugin-utils';

function getMountPointData<T = any, T2 = any>(
  mountPoint: string,
): {
  config: MountPointConfig;
  Component: T;
  staticJSXContent: T2;
}[] {
  return getScalprum().api.dynamicRootConfig?.mountPoints?.[mountPoint] ?? [];
}

export default getMountPointData;
