import {
  ReportIssue as ReportIssueBase,
  techdocsModuleAddonsContribPlugin,
} from "@backstage/plugin-techdocs-module-addons-contrib";

import React from "react";

import {
  createTechDocsAddonExtension,
  TechDocsAddonLocations,
} from "@backstage/plugin-techdocs-react";

import { ShadowRootStylesProvider } from "./ShadowRootStylesProvider";

/**
 * Automatically wrap the backstage ReportIssue component with a (JSS)
 * StylesProvider, the underlaying styling technique under MUI v4.
 *
 * With this, the additional styles for overlay button are applied correctly
 * because the techdocs content is rendered in a shadow root, but the styles
 * from the ReportIssue components are added to the root document.
 *
 * It isn't possible to create an additional shadow root here without reusing
 * or copying more components from the techdocs packages.
 *
 * The addons are rendered with a (react) portal above the content while the
 * addon itself is added below the content.
 *
 * HTML structure:
 *
 * html root doc
 *   backstage sidebar
 *   backstage header
 *   techdocs shadow root
 *     left sidebar (content navigation)
 *     right sidebar (table of content)
 *     content
 *       (report issue link is added here when text is selected)
 *       content itself
 *       addons
 *         report issue wrapper
 */
const ReportIssueWrapper = () => {
  return (
    <div id="techdocs-report-issue-wrapper">
      <ShadowRootStylesProvider>
        <ReportIssueBase />
      </ShadowRootStylesProvider>
    </div>
  );
};

export const ReportIssue = techdocsModuleAddonsContribPlugin.provide(
  createTechDocsAddonExtension<{}>({
    name: "ReportIssue",
    location: TechDocsAddonLocations.Content,
    component: ReportIssueWrapper,
  }),
);
