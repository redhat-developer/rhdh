import { test as base } from "@playwright/test";
import { UIhelper } from "../../utils/ui-helper";
import { Common } from "../../utils/common";

type BaseFixture = {
  uiHelper: UIhelper;
  common: Common;
};

// eslint-disable-next-line @typescript-eslint/naming-convention
export const baseTest = base.extend<BaseFixture>({
  uiHelper: async ({ page }, use) => {
    const uiHelper = new UIhelper(page);
    await use(uiHelper);
  },
  common: async ({ page }, use) => {
    const common = new Common(page);
    await use(common);
  },
});
