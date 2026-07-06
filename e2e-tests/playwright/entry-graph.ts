/**
 * Side-effect imports that connect Playwright support modules to config entry points
 * for static analysis and fixture wiring.
 */
/* oxlint-disable import/no-unassigned-import -- intentional side-effect graph wiring */

import "./support/coverage/test";
import { createBrowserSession } from "./support/browser-session";
import CoverageReporter from "./support/coverage/reporter";
import requireDynamicPluginsPopulated from "./support/local-harness-global-setup";
import { runWorkerCleanups } from "./support/worker-session";
import "./utils/common/browser";
import "./utils/ui-helper/navigation";
import "./blocked/entry-graph";
import { ensureRuntimeDeployed } from "./utils/runtime-deploy";

void createBrowserSession;
void CoverageReporter;
void requireDynamicPluginsPopulated;
void runWorkerCleanups;
void ensureRuntimeDeployed;
