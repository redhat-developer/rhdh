import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import { authOwnershipResolutionExtensionPoint } from '@backstage/plugin-auth-node';

import { TransitiveGroupOwnershipResolver } from '../transitiveGroupOwnershipResolver';

/**
 * Registers RHDH's transitive group ownership resolver on the auth plugin.
 */
const authOwnershipModule = createBackendModule({
  pluginId: 'auth',
  moduleId: 'auth-ownership',
  register(reg) {
    reg.registerInit({
      deps: {
        config: coreServices.rootConfig,
        authOwnershipResolution: authOwnershipResolutionExtensionPoint,
        discovery: coreServices.discovery,
        auth: coreServices.auth,
      },
      async init({ config, authOwnershipResolution, discovery, auth }) {
        authOwnershipResolution.setAuthOwnershipResolver(
          new TransitiveGroupOwnershipResolver({ discovery, config, auth }),
        );
      },
    });
  },
});

export default authOwnershipModule;
