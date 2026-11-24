import assert from "node:assert/strict";
import type { CheckContext } from "./run";
import { toggle, waitForState, withBrowser } from "./lib/check";
import { coldCut, withBridge } from "./lib/cut";

export default async function S4(context: CheckContext) {
  await context.bridge.clear();
  return withBridge(context, () => withBrowser(context, async (browser, page) => {
    const { root, ids, elapsed } = await coldCut(context, browser, page, "warp");
    const excluded = page.locator("h1, h2, h3, table, pre, figcaption, header nav, footer");
    const protectedText = () => excluded.allTextContents();
    const during = await protectedText();
    const height = (await root.boundingBox())!.height;
    await toggle(page);
    await waitForState(page, "picks-ready");
    const originalHeight = (await root.boundingBox())!.height;
    assert.ok(height < originalHeight, `Warp took ${height}px cut vs ${originalHeight}px original`);
    assert.deepEqual(await protectedText(), during);
    return `${ids.length} sentences removed in ${elapsed.toFixed(1)} ms, ${originalHeight - height}px shorter, ${during.length} excluded elements unchanged`;
  }));
}
