import assert from "node:assert/strict";
import type { CheckContext } from "./run";
import { toggle, waitForState, withBrowser } from "./lib/check";
import { coldCut, snapshot, withBridge } from "./lib/cut";
import { geometry, installGeometry } from "./lib/geometry";
import { screenshot, save, crop, difference } from "./lib/pixels";

export default async function S1(context: CheckContext) {
  await context.bridge.clear();
  return withBridge(context, () => withBrowser(context, async (browser, page) => {
    await installGeometry(browser.context);
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    const { root, row, ids, elapsed } = await coldCut(context, browser, page, "wang");
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => scrollTo(0, 0));
    const cut = (await screenshot(page)).png;
    const height = (await snapshot(root)).height;
    const markerWidth = await root.locator("[data-filler-cut-marker]").evaluateAll((nodes) =>
      nodes.reduce((total, node) => total + node.getBoundingClientRect().width, 0));
    await toggle(page);
    await waitForState(page, "picks-ready");
    await page.evaluate(() => scrollTo(0, 0));
    const off = (await screenshot(page)).png;
    const layout = await geometry(page);
    const title = layout.protectedText.filter(({ width, height, y }) => width && height && y >= 0);
    assert.ok(title.length, "Wang title or author coordinates unavailable");
    for (const box of title) assert.equal(difference(crop(cut, box), crop(off, box)), 0);
    const originalHeight = (await snapshot(root)).height;
    const removedWidth = ids.flatMap((id) => layout.sentences[id - 1]).reduce((total, box) => total + box.width, 0);
    assert.ok(markerWidth < removedWidth, `Markers take ${markerWidth}px vs ${removedWidth}px of original text`);
    await save(context.evidence + "/wang-original", off);
    return `${ids.length} sentences removed in ${elapsed.toFixed(1)} ms, ${Math.round(originalHeight - height)}px height reduction, ${Math.round(removedWidth - markerWidth)}px less inline text, title/byline pixels unchanged, ${row.piCalls} Pi calls`;
  }));
}
