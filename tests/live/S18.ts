import assert from "node:assert/strict";
import type { CheckContext } from "./run";
import { maxMarks } from "../../src/shared/config";
import { toggle, waitForState, withBrowser } from "./lib/check";
import { cacheEntry, pickedFades, withBridge } from "./lib/fade";
import { changedSentences, geometry, installGeometry } from "./lib/geometry";
import { assertMarkedSelection, painted, settled, tintedPixels } from "./lib/marks";
import { save, screenshot } from "./lib/pixels";

export default async function S18(context: CheckContext) {
  return withBridge(context, () => withBrowser(context, async (browser, page) => {
    await installGeometry(browser.context);
    const index = (await context.bridge.requests()).length;
    await browser.open(page, "warp");
    await waitForState(page, "faded");
    await page.waitForLoadState("load", { timeout: 12_000 }).catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    const rejectCookies = page.getByRole("button", { name: "Reject all cookies", exact: true });
    // The consent overlay dims every pixel beneath it, including the key tint.
    await rejectCookies.waitFor({ state: "visible", timeout: 3000 }).then(async () => {
      await rejectCookies.click();
      await rejectCookies.waitFor({ state: "hidden" });
      await page.mouse.move(0, 0);
    }, () => {});
    const response = await context.bridge.waitForRequest(index);
    const entry = await cacheEntry(context, response.cacheKey);
    const paint = await painted(page);
    const marks = assertMarkedSelection(entry, paint);
    await toggle(page);
    await waitForState(page, "picks-ready");
    await settled(page, false);
    const original = (await screenshot(page)).png;
    const layout = await geometry(page);
    await toggle(page);
    await waitForState(page, "faded");
    await settled(page, true);
    const image = (await screenshot(page)).png;
    await save(context.evidence + "/warp-fades-and-marks", image);
    const tinted = marks.filter((id) => tintedPixels(original, image, layout.sentences[id - 1]) > 100);
    assert.ok(tinted.length > 0, "Warp screenshot contains no visible marks");
    const faded = pickedFades(entry);
    const visibleFades = changedSentences(original, image, layout).filter((id) => faded.includes(id)).length;
    assert.ok(visibleFades > 0, "Warp screenshot contains no visible fades");
    return `Warp ${entry.sentences.length} sentences, ${marks.length}/${maxMarks(entry.sentences.length)} marks and ${paint.faded} fades, 0 overlaps; screenshot shows ${tinted.length} marks and ${visibleFades} fades`;
  }, true, { width: 1280, height: 4900 }));
}
