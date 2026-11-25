import assert from "node:assert/strict";
import type { CheckContext } from "./run";
import { withBrowser } from "./lib/check";
import { referenceCut, withBridge } from "./lib/cut";
import { save, screenshot } from "./lib/pixels";

export default async function S15(context: CheckContext) {
  return withBridge(context, () => withBrowser(context, async (browser, page) => {
    const { root, ids } = await referenceCut(context, browser, page, "warp");
    await page.evaluate(() => document.fonts.ready);
    const links = root.locator("a[href^=http]:visible").filter({ hasText: /\w+/ });
    const { href, attribute } = await links.first().evaluate((node: HTMLAnchorElement) => {
      node.scrollIntoView({ block: "center", behavior: "instant" });
      return { href: node.href, attribute: node.getAttribute("href")! };
    });
    const link = root.locator(`a[href=${JSON.stringify(attribute)}]:visible`).first();
    await save(context.evidence + "/warp-link", (await screenshot(page)).png);
    const from = (await context.bridge.events()).length;
    const atClick = page.evaluate(() => new Promise<number>((resolve) => {
      window.addEventListener("click", () => resolve(Number(document.documentElement.dataset.fillerCutFaded)), { once: true });
    }));
    const destination = browser.context.waitForEvent("request", {
      predicate: (request) => request.isNavigationRequest() && request.url() === href, timeout: 10_000,
    });
    const [, , count] = await Promise.all([destination, link.click({ timeout: 10_000 }), atClick]);
    assert.equal(count, ids.length);
    const clicks = (await context.bridge.events()).slice(from).filter(({ type }) => type === "restore");
    assert.equal(clicks.length, 0);
    return `Kept link followed to ${href}, no expansion`;
  }));
}
