import { techdocsPlugin } from "@backstage/plugin-techdocs";
import { ReportIssueWrapper } from "./ReportIssueWrapper";
import {
  createTechDocsAddonExtension,
  TechDocsAddonLocations,
} from "@backstage/plugin-techdocs-react";

export const ReportIssue = techdocsPlugin.provide(
  createTechDocsAddonExtension<{}>({
    name: "ReportIssue",
    location: TechDocsAddonLocations.Content,
    component: ReportIssueWrapper,
  }),
);
