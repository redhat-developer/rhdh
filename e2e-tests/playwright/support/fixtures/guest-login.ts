import { baseTest } from "./base";
import { Common } from "../../utils/common";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const guestTest = baseTest.extend({
  common: async ({ page }, use) => {
    const common = new Common(page);
    await common.loginAsGuest();
    await use(common);
  },
});

export { expect } from "@playwright/test";
