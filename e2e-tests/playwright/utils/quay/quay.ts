import { Page } from "@playwright/test";
import { UI_HELPER_ELEMENTS } from "../../support/page-objects/global-obj";

export class ImageRegistry {
  static getAllCellsIdentifier() {
    const tagText = /^(pr|next)-.*$/i; // Example: pr-123 or pr-123-abc
    const lastModifiedDate =
      /^[A-Za-z]{3} \d{1,2}, \d{4}, \d{1,2}:\d{2} (AM|PM)$/; // Example: Jan 21, 2025, 7:54 PM
    const size = /^\d+(\.\d+)?\s?(GB|MB)$/; // Example: 1.16 GB or 512 MB
    const expires =
      /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{1,2}:\d{2}:\d{2} [+-]\d{4}$/; // Example: Tue, 04 Feb 2025 22:54:18 -0000

    const manifest = /^sha256/;
    const securityScan =
      /^(?:Critical:\s\d+)?(?:,\s)?(?:High:\s\d+)?(?:,\s)?(?:Medium:\s\d+)?(?:,\s)?(?:Low:\s\d+)?(?:,\s)?(?:Unknown:\s\d+)?$|^Queued$/i;
    return [tagText, lastModifiedDate, securityScan, size, expires, manifest];
  }

  static getAllGridColumnsText() {
    return [
      "Tag",
      "Last Modified",
      "Security Scan",
      "Size",
      "Expires",
      "Manifest",
    ];
  }

  static securityScanRegex() {
    const securityScan = ["Critical", "High", "Medium", "Low", "Unknown"].map(
      (i) => `(${i}:\\s\\d+[^\\w]*)`,
    );
    return new RegExp(
      `^(Passed|unsupported|Queued|Medium|Low|(?:${securityScan.join("|")})+)$`,
    );
  }

  static getAllScanColumnsText() {
    return [
      "Advisory",
      "Severity",
      "Package Name",
      "Current Version",
      "Fixed By",
    ];
  }

  static getScanCellsIdentifier() {
    const advisory = /^(CVE|RHSA)-.+/;
    const severity = /Critical|High|Medium|Low|Unknown/;
    const version = /^(\d+:)?\d+\.\d+/;

    return [advisory, severity, version];
  }

  static async getScanCell(page: Page) {
    const locator = page
      .locator(UI_HELPER_ELEMENTS.MuiTableCell)
      .filter({ hasText: this.securityScanRegex() });
    await locator.first().waitFor();
    return locator.first();
  }
}
