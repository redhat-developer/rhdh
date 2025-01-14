import { ShadowRootStylesProvider } from "./ShadowRootStylesProvider";
import { ReportIssue as ReportIssueBase } from "@backstage/plugin-techdocs-module-addons-contrib";

export const ReportIssueWrapper = () => {
  return (
    <div id="techdocs-report-issue-wrapper">
      <ShadowRootStylesProvider>
        <ReportIssueBase />
      </ShadowRootStylesProvider>
    </div>
  );
};
