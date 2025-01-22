import { getScalprum } from '@scalprum/core';

function getTechDocsExtentionsData<T = any>(): {
  scope: string;
  module: string;
  importName: string;
  Component: T;
}[] {
  return getScalprum().api.dynamicRootConfig?.techdocsFieldExtensions ?? [];
}

export default getTechDocsExtentionsData;
