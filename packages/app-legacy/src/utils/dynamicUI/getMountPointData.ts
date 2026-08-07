import { MountPointConfig } from '@red-hat-developer-hub/plugin-utils';
import { getScalprum } from '@scalprum/core';

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
