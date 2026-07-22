import { type Page } from "@playwright/test";

import { getCurrentLanguage, getTranslations, type Locale } from "../../e2e/localization/locale";
import * as interaction from "../../utils/ui-helper/interaction";
import * as navigation from "../../utils/ui-helper/navigation";
import * as verification from "../../utils/ui-helper/verification";
import { waitForAppReady } from "./app-shell";

const t = getTranslations();

export async function signInAsGuest(
  page: Page,
  options?: { timeout?: number; locale?: Locale },
): Promise<void> {
  const lang = options?.locale ?? getCurrentLanguage();
  const timeout = options?.timeout ?? 120_000;

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
