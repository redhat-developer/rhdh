export interface Config {
  app: {
    branding?: {
      /**
       * Base64 URI for the full logo. If the value is a string, it is used as the logo for both themes.
       * @visibility frontend
       */
      // this config is copied to rhdh-plugins/global-header config.d.ts and should be kept in sync
      fullLogo?:
        | string
        | {
            /**
             * Base64 URI for the logo in light theme
             * @visibility frontend
             */
            light: string;
            /**
             * Base64 URI for the logo in dark theme
             * @visibility frontend
             */
            dark: string;
          };
      /**
       * size Configuration for the full logo
       * The following units are supported: <number>, px, em, rem, <percentage>
       * @visibility frontend
       */
      fullLogoWidth?: string | number;
      /**
       * Base64 URI for the icon logo. If the value is a string, it is used as the logo for both themes.
       * @visibility frontend
       */
      iconLogo?:
        | string
        | {
            /**
             * Base64 URI for the icon logo in light theme
             * @visibility frontend
             */
            light: string;
            /**
             * Base64 URI for the icon logo in dark theme
             * @visibility frontend
             */
            dark: string;
          };
    };
  };
}
