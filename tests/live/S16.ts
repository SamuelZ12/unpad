// Reload faded Warp. Within 1 s of the text appearing in the DOM the page
// is faded, and the bridge reports a cache hit with 0 Pi calls.
import assert from "node:assert/strict";
import type { CheckContext } from "./run";
import { roots } from "./lib/browser";
import { atMost, trace, waitForState, withBrowser } from "./lib/check";
import { withBridge } from "./lib/cut";
import { docCrop, save } from "./lib/pixels";

export default async function S16(context: CheckContext) {
  return withBridge(context, () => withBrowser(context, async (browser, page) => {
    await browser.context.addInitScript((selector) => {
      const observer = new MutationObserver(() => {
        if (!document.querySelector(selector)?.textContent?.trim()) return;
        Object.defineProperty(window, "fillerCutTextAt", { value: Date.now() });
        observer.disconnect();
      });
      observer.observe(document, { childList: true, subtree: true });
    }, roots.warp);
    await browser.open(page, "warp");
    await waitForState(page, "faded");
    const index = (await context.bridge.requests()).length;
    const root = await browser.open(page, "warp");
    await waitForState(page, "faded");
    const row = await context.bridge.waitForRequest(index);
    assert.equal(row.source, "cache");
    assert.equal(row.piCalls, 0);
    const textAt = await page.evaluate(() => (window as unknown as { fillerCutTextAt: number }).fillerCutTextAt);
    assert.ok(textAt > 0, "Article insertion timestamp missing");
    const elapsed = (await trace(page)).find(({ view }) => view === "faded")!.at - textAt;
    await save(context.evidence + "/cached", await docCrop(root));
    atMost(elapsed, 1000, "Article text to faded");
    return `${elapsed.toFixed(1)} ms from article text, ${row.ms.toFixed(1)} ms bridge cache hit, 0 Pi calls`;
  }));
}
