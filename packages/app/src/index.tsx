import "@backstage/cli/asset-types";
import ReactDOM from "react-dom/client";
import app from "./App";
import "@backstage/ui/css/styles.css";
import "material-icons/iconfont/outlined.css";

// Masthead is full-width with company logo by default (PF / OFS). Sidebar
// branding is suppressed by the theme when `#global-header` is present —
// do not re-introduce app CSS that insets the header or hides the logo.

ReactDOM.createRoot(document.getElementById("root")!).render(app);
