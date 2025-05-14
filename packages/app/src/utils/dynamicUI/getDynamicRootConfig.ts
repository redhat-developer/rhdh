import { getScalprum } from '@scalprum/core';

import { DynamicRootConfig } from '@internal/plugin-utils';

function getDynamicRootConfig(): DynamicRootConfig {
  return getScalprum().api.dynamicRootConfig;
}

export default getDynamicRootConfig;
