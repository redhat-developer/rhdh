import { createBackendFeatureLoader } from "@backstage/backend-plugin-api";
import {
  catalogPluginGitlabFillerProcessorModule,
  gitlabPlugin,
} from "@immobiliarelabs/backstage-plugin-gitlab-backend";

export const bundle = createBackendFeatureLoader({
  async loader() {
    return [gitlabPlugin, catalogPluginGitlabFillerProcessorModule];
  },
});
