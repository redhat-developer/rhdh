export interface Config {
  /** Configurations for the backstage(janus) instance */
  developerHub?: {
    /**
     * The url of json data for customization.
     * @visibility frontend
     */
    proxyPath?: string;
    /**
     * Name of the Backstage flavor (e.g. backstage, rhdh, rhtap)
     * @visibility frontend
     */
    flavor?: string;
  };
  app: {
    branding?: {
      /**
       * Base64 URI for the full logo
       * @visibility frontend
       */
      fullLogo?: string;
      /**
       * size Configuration for the full logo
       * The following units are supported: <number>, px, em, rem, <percentage>
       * @visibility frontend
       */
      fullLogoWidth?: string | number;
      /**
       * Base64 URI for the icon logo
       * @visibility frontend
       */
      iconLogo?: string;
      /**
       * @deepVisibility frontend
       */
      theme?: {
        [key: string]: unknown;
      };
    };
  };
  /** @deepVisibility frontend */
  dynamicPlugins: {
    /** @deepVisibility frontend */
    frontend?: {
      [key: string]: {
        dynamicRoutes?: {
          path: string;
          module?: string;
          importName?: string;
          menuItem?: {
            icon: string;
            text: string;
          };
          config: {
            props?: {
              [key: string]: string;
            };
          };
        }[];
        routeBindings?: {
          targets?: {
            module?: string;
            importName: string;
            name?: string;
          }[];
          bindings?: {
            bindTarget: string;
            bindMap: {
              [key: string]: string;
            };
          }[];
        };
        entityTabs?: {
          path: string;
          title: string;
          mountPoint: string;
        }[];
        mountPoints?: {
          mountPoint: string;
          module?: string;
          importName?: string;
          config: {
            layout?: {
              [key: string]:
                | string
                | {
                    [key: string]: string;
                  };
            };
            props?: {
              [key: string]: string;
            };
            if?: {
              allOf?: (
                | {
                    [key: string]: string | string[];
                  }
                | string
              )[];
              anyOf?: (
                | {
                    [key: string]: string | string[];
                  }
                | string
              )[];
              oneOf?: (
                | {
                    [key: string]: string | string[];
                  }
                | string
              )[];
            };
          };
        }[];
        appIcons?: {
          module?: string;
          importName?: string;
          name: string;
        }[];
        apiFactories?: {
          module?: string;
          importName?: string;
        }[];
      };
    };
  };
  /**
   * The signInPage provider
   * @visibility frontend
   */
  signInPage?: string;
  /**
   * The option to allow sign in without existing user in the catalog, defaults to false
   * @visibility frontend
   */
  dangerouslyAllowSignInWithoutUserInCatalog?: boolean;
  /**
   * The option to includes transient parent groups when determining user group membership
   * @visibility frontend
   */
  includeTransientGroupOwnership?: boolean;
}
