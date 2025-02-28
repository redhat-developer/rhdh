import { DynamicConfig, TechdocsAddon } from "./types";

function getTechdocsAddonData(dynamicConfig: DynamicConfig): TechdocsAddon[] {
  return dynamicConfig?.techdocsAddons ?? [];
}

export function getTechdocsAddonComponents(dynamicConfig: DynamicConfig) {
  const techdocsAddonsData = getTechdocsAddonData(dynamicConfig);
  return techdocsAddonsData.map(
    ({ scope, module, importName, Component, config }) => (
      <Component key={`${scope}-${module}-${importName}`} {...config.props} />
    ),
  );
}
