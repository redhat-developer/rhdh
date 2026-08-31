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

  /**
   * Allows you to customize RHDH Metadata card information
   * @deepVisibility frontend
   */
  buildInfo?: {
    /**
     * Allows setting a title for the build information card
     * @visibility frontend
     */
    title: string;
    /**
     * Optional translation key for the title.
     * @visibility frontend
     */
    titleKey?: string;
    /**
     * Allows setting a content for the build information card
     * @visibility frontend
     */
    card: { [key: string]: string };
    /**
     * Allows setting if the default build information (RHDH Version, Backstage Version, etc.) should be overridden
     * Contents will be overridden if not set to false
     * @default true
     * @visibility frontend
     */
    overrideBuildInfo?: boolean;
  };

  /**
   * Configuration options for your user settings.
   * @deepVisibility frontend
   */
  userSettings?: {
    /**
     * The persistence mode for user settings.
     * @visibility frontend
     */
    persistence: 'browser' | 'database';
  };
}
