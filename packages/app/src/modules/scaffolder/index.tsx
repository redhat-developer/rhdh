import {
  createExtensionInput,
  createFrontendModule,
  createRouteRef,
  PageBlueprint,
} from "@backstage/frontend-plugin-api";
import { FormFieldBlueprint } from "@backstage/plugin-scaffolder-react/alpha";
import CreateComponentIcon from "@material-ui/icons/AddCircleOutline";

/** RHDH product title for the scaffolder page (RHDHBUGS-3676). */
const SELF_SERVICE_TITLE = "Self-service";

/**
 * Replaces upstream `page:scaffolder`, which hardcodes title "Create".
 * Keeps the same formFields input, icon, and /create route as upstream.
 *
 * Note: The `@backstage/plugin-scaffolder` plugin itself is decoupled and NOT
 * included in the core app bundle (loaded dynamically via OCI). This local module
 * only sets the default RHDH page title to "Self-service".
 */
const scaffolderPage = PageBlueprint.makeWithOverrides({
  inputs: {
    formFields: createExtensionInput([
      FormFieldBlueprint.dataRefs.formFieldLoader,
    ]),
  },
  factory(originalFactory) {
    return originalFactory({
      path: "/create",
      title: SELF_SERVICE_TITLE,
      routeRef: createRouteRef({ aliasFor: "scaffolder.root" }),
      icon: <CreateComponentIcon fontSize="inherit" />,
    });
  },
});

export const scaffolderSelfServiceModule = createFrontendModule({
  pluginId: "scaffolder",
  extensions: [scaffolderPage],
});
