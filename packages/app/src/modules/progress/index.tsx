import {
  createFrontendModule,
  Progress as SwappableProgress,
} from "@backstage/frontend-plugin-api";
import { SwappableComponentBlueprint } from "@backstage/plugin-app-react";
import { Progress } from "./Progress";

/**
 * Overrides the default app `core-progress` swappable component with a
 * conspicuous red bar (demo / verification of NFS component overrides).
 */
const coreProgress = SwappableComponentBlueprint.make({
  name: "core-progress",
  params: (define) =>
    define({
      component: SwappableProgress,
      loader: () => Progress,
    }),
});

export const rhdhProgressModule = createFrontendModule({
  pluginId: "app",
  extensions: [coreProgress],
});
