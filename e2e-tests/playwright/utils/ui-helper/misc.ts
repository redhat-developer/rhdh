import { Page } from "@playwright/test";

import { getCurrentLanguage } from "../../e2e/localization/locale";
import { openSidebar, selectMuiBox } from "./navigation";
import { verifyRowsInTable } from "./verification";

const lang = getCurrentLanguage();

const quickstartHideLabel = {
  en: "Hide",
  de: "Ausblenden",
  es: "Ocultar",
  fr: "Cacher",
  it: "Nascondi",
  ja: "非表示",
} as const;

function getQuickstartHideButton(page: Page) {
  const label = quickstartHideLabel[lang] ?? quickstartHideLabel.en;
  return page.getByRole("button", { name: label });
}

export async function hideQuickstartIfVisible(page: Page): Promise<void> {
  const quickstartHideButton = getQuickstartHideButton(page);
  if (await quickstartHideButton.isVisible()) {
    await quickstartHideButton.click();
    await quickstartHideButton.waitFor({ state: "hidden", timeout: 5000 });
  }
}

export async function verifyComponentInCatalog(page: Page, kind: string, expectedRows: string[]) {
  await openSidebar(page, "Catalog");
  await selectMuiBox(page, "Kind", kind);
  await verifyRowsInTable(page, expectedRows);
}
