import { getScalprum } from '@scalprum/core';

import { DynamicRootConfig } from '../../components/DynamicRoot/DynamicRootContext';

function getDynamicRootConfig(): DynamicRootConfig {
  return getScalprum().api.dynamicRootConfig;
}

export default getDynamicRootConfig;
