import {
  createExtensionInput,
  createRouteRef,
  PageBlueprint,
} from "@backstage/frontend-plugin-api";
import scaffolderPlugin from "@backstage/plugin-scaffolder/alpha";
import { FormFieldBlueprint } from "@backstage/plugin-scaffolder-react/alpha";
import CreateComponentIcon from "@material-ui/icons/AddCircleOutline";

/** RHDH product title for the scaffolder page (RHDHBUGS-3676). */
const SELF_SERVICE_TITLE = "Self-service";

/**
 * Replaces upstream `page:scaffolder`, which hardcodes title "Create".
 * Keeps the same formFields input and /create route as upstream.
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

export const rhdhScaffolderPlugin: typeof scaffolderPlugin =
  scaffolderPlugin.withOverrides({
    title: SELF_SERVICE_TITLE,
    extensions: [scaffolderPage],
  });
