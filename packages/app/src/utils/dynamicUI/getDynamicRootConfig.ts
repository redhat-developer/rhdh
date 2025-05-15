import { DynamicRootConfig } from '@internal/plugin-utils';
import { getScalprum } from '@scalprum/core';

function getDynamicRootConfig(): DynamicRootConfig {
  return getScalprum().api.dynamicRootConfig;
}

export default getDynamicRootConfig;
