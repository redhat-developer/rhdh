import { getScalprum } from '@scalprum/core';

function getTechdocsAddonData<T = any>(): {
  scope: string;
  module: string;
  importName: string;
  Component: T;
  config: {
    props?: Record<string, any>;
  };
}[] {
  return getScalprum().api.dynamicRootConfig?.techdocsAddons ?? [];
}

export default getTechdocsAddonData;
