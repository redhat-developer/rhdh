import { type Locator } from "@playwright/test";

/** Computed styles report colours as rgb(); app-config uses hex (#rrggbb). */
export function hexToRgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * The colour actually painted behind an element: its own background, or that of
 * the closest ancestor with a non-transparent one.
 */
export function getPaintedBackground(locator: Locator): Promise<string> {
  return locator.evaluate((element) => {
    for (let node: Element | null = element; node; node = node.parentElement) {
      const color = getComputedStyle(node).backgroundColor;
      if (color !== "rgba(0, 0, 0, 0)" && color !== "transparent") {
        return color;
      }
    }
    return getComputedStyle(document.body).backgroundColor;
  });
}
