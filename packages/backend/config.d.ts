export interface Config {
  dynamicPlugins?: {
    frontend?: {
      compressionDictionary?: {
        /**
         * Enable HTTP Compression Dictionary Transport for dynamic frontend plugin assets.
         * @default false
         */
        enabled?: boolean;
      };
    };
  };
}
