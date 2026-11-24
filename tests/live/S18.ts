import assert from "node:assert/strict";
import type { CheckContext } from "./run";
import { toggle, waitForState, withBrowser } from "./lib/check";
import { referenceCut, withBridge } from "./lib/cut";
import { assertMarked, marked, tintedPixels } from "./lib/marks";
import { save, screenshot } from "./lib/pixels";

export default async function S18(context: CheckContext) {
  return withBridge(context, () => withBrowser(context, async (browser, page) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const { root, entry, ids } = await referenceCut(context, browser, page, "warp");
    const consent = page.getByRole("button", { name: "Reject all cookies", exact: true });
    await consent.waitFor({ state: "visible", timeout: 2500 }).then(() => consent.click(), () => {});
    await page.evaluate(() => document.fonts.ready);
    const marks = await assertMarked(page, entry);
    const offset = await root.locator("[data-filler-cut-marker]").evaluateAll((markers, positions) => {
      const offsets = markers.map((marker) => marker.getBoundingClientRect().top);
      const middle = offsets.find((top) => positions.some((y) => Math.abs(top - y) < 180));
      return (middle ?? positions[0]) - 380;
    }, marks.flatMap(({ boxes }) => boxes.map(({ y }) => y)));
    await page.evaluate((top) => scrollBy({ top, behavior: "instant" }), offset);
    const image = (await screenshot(page)).png;
    await save(context.evidence + "/warp-cut", image);
    const tinted = tintedPixels(image, (await marked(page)).flatMap(({ boxes }) => boxes));
    assert.ok(tinted > 100, `Did not see yellow tint on Warp (${tinted} pixels)`);
    await toggle(page);
    await waitForState(page, "picks-ready");
    assert.deepEqual(await marked(page), []);
    return `Warp ${marks.length} marks (${tinted} tinted pixels) and ${ids.length} sentences removed; lens off clears tint`;
  }));
}
