import { type Page } from "@playwright/test";

import { getCurrentLanguage, getTranslations } from "../../e2e/localization/locale";
import * as interaction from "../../utils/ui-helper/interaction";
import * as navigation from "../../utils/ui-helper/navigation";
import * as verification from "../../utils/ui-helper/verification";
import { waitForAppReady } from "./app-shell";

const t = getTranslations();
const lang = getCurrentLanguage();

export async function signInAsGuest(page: Page, timeout = 120_000): Promise<void> {
  await page.goto("/");
  await waitForAppReady(page, timeout);

  page.once("dialog", async (dialog) => {
    console.log(`Dialog message: ${dialog.message()}`);
    await dialog.accept();
  });

  await verification.verifyHeading(page, t["rhdh"][lang]["signIn.page.title"], timeout);
  await interaction.clickButton(page, t["core-components"][lang]["signIn.guestProvider.enter"]);
  await navigation.waitForSideBarVisible(page);
}
