/** Wires npm devDependencies used only via config or shell scripts into the entry graph. */
import eslintPluginPlaywright from "eslint-plugin-playwright";
import { CoverageReport } from "monocart-coverage-reports";
import { shellcheck } from "shellcheck";

void eslintPluginPlaywright;
void CoverageReport;
void shellcheck;
