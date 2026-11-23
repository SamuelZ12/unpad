import assert from "node:assert/strict";
import type { CheckContext } from "./run";
import { state } from "./lib/browser";
import { toggle, trace, waitForState, withBrowser } from "./lib/check";
import { withBridge } from "./lib/fade";

export default async function S14(context: CheckContext) {
  return withBridge(context, () => withBrowser(context, async (browser, page) => {
    await browser.open(page, "warp");
    const faded = await waitForState(page, "faded");
    const field = page.locator("input[type=email]:visible").first();
    await field.focus();
    const before = (await trace(page)).length;
    await toggle(page);
    await page.keyboard.type("reader@example.com");
    await page.keyboard.down("Shift");
    await Bun.sleep(1000);
    assert.deepEqual(await state(page), faded);
    await page.keyboard.up("Shift");
    assert.equal((await trace(page)).length, before);
    assert.equal(await field.inputValue(), "reader@example.com");
    return "18 characters typed, 1000 ms Shift hold, 0 state transitions";
  }));
}
