import "@backstage/cli/asset-types";
import { sidebarConfig } from "@backstage/core-components";
import ReactDOM from "react-dom/client";
import app from "./App";
import "@backstage/ui/css/styles.css";
import "material-icons/iconfont/outlined.css";

const { drawerWidthOpen, drawerWidthClosed } = sidebarConfig;

// Disable Logo from global header plugin (if it's installed/enabled)
const style = document.createElement("style");
style.textContent = `
  #global-header {
    width: auto;
    margin-right: var(--docked-drawer-width, 0px);
    transition:
      margin-left 0.1s ease-out,
      margin-right 225ms cubic-bezier(0, 0, 0.2, 1);
  }
  /* Branding lives in the sidebar; avoid duplicate header logo. */
  [data-testid='global-header-company-logo'] {
    display: none;
  }
  /* Keep the header over main content only — not above the sidebar logo column. */
  @media (min-width: 600px) {
    #global-header {
      margin-left: ${drawerWidthOpen}px;
      width: calc(100% - ${drawerWidthOpen}px);
    }
    body:has([data-testid='sidebar-root'] [class*='BackstageSidebar-drawer']:not([class*='drawerOpen']))
      #global-header {
      margin-left: ${drawerWidthClosed}px;
      width: calc(100% - ${drawerWidthClosed}px);
    }
  }
`;
document.head.appendChild(style);

ReactDOM.createRoot(document.getElementById("root")!).render(app);
