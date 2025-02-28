export type TechdocsAddon = {
  scope: string;
  module: string;
  importName: string;
  Component: React.ComponentType<React.PropsWithChildren>;
  config: {
    props?: Record<string, any>;
  };
};

export type DynamicConfig = {
  techdocsAddons: TechdocsAddon[];
};
