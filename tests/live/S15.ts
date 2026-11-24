// Click a link inside a faded sentence on Warp. The browser follows the link,
// the sentence stays faded at the click, and the bridge records 0 restores.
import assert from "node:assert/strict";
import type { CheckContext } from "./run";
import { waitForState, withBrowser } from "./lib/check";
import { cacheEntry, pickedFades, withBridge } from "./lib/fade";
import { geometry, installGeometry } from "./lib/geometry";
import { save, screenshot } from "./lib/pixels";

export default async function S15(context: CheckContext) {
  return withBridge(context, () => withBrowser(context, async (browser, page) => {
    await installGeometry(browser.context);
    const index = (await context.bridge.requests()).length;
    const root = await browser.open(page, "warp");
    const faded = await waitForState(page, "faded");
    const row = await context.bridge.waitForRequest(index);
    const ids = pickedFades(await cacheEntry(context, row.cacheKey));
    const layout = await geometry(page);
    const anchors = await root.locator("a[href]").evaluateAll((elements) => elements.map((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const rect = range.getBoundingClientRect();
      return { href: (element as HTMLAnchorElement).href, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }));
    const hit = anchors.findIndex(({ x, y }) => ids.some((id) => layout.sentences[id - 1]
      .some((rect) => x >= rect.x && y >= rect.y && x <= rect.x + rect.width && y <= rect.y + rect.height)));
    assert.ok(hit >= 0, `Warp had ${anchors.length} article links and ${faded.faded} faded sentences, with zero intersections`);
    const link = root.locator("a[href]").nth(hit);
    await link.scrollIntoViewIfNeeded();
    await save(context.evidence + "/warp-link", (await screenshot(page)).png);
    const from = (await context.bridge.events()).length;
    const href = anchors[hit].href;
    const fadedOnClick = page.evaluate(() => new Promise<number>((resolve) => {
      window.addEventListener("click", () => {
        resolve(Number(document.documentElement.dataset.fillerCutFaded));
      }, { capture: true, once: true });
    }));
    const destination = browser.context.waitForEvent("request", {
      predicate: (request) => request.isNavigationRequest() && request.url() === href, timeout: 10_000,
    });
    const [, , count] = await Promise.all([destination, link.click({ timeout: 10_000 }), fadedOnClick]);
    assert.equal(count, faded.faded, "The click changed the faded count");
    await Bun.sleep(300);
    const restores = (await context.bridge.events()).slice(from).filter((event) => event.type === "restore");
    assert.equal(restores.length, 0);
    return `browser followed ${href}; 0 restores from clicking inside one of ${faded.faded} faded sentences`;
  }));
}
