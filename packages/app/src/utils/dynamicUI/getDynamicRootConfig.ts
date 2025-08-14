import { DynamicRootConfig } from '@red-hat-developer-hub/plugin-utils';
import { getScalprum } from '@scalprum/core';

function getDynamicRootConfig(): DynamicRootConfig {
  return getScalprum().api.dynamicRootConfig;
}

export default getDynamicRootConfig;
