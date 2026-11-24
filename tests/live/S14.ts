// Focus Warp's newsletter email field with the page faded. Type the toggle
// combination and hold Shift for 1 s. The page stays faded and the field
// receives the typed characters.
import assert from "node:assert/strict";
import type { CheckContext } from "./run";
import { state } from "./lib/browser";
import { toggle, trace, waitForState, withBrowser } from "./lib/check";
import { withBridge } from "./lib/cut";
import { save, screenshot } from "./lib/pixels";

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
    await save(context.evidence + "/newsletter", (await screenshot(page)).png);
    return "18 characters typed, 1000 ms Shift hold, 0 state transitions";
  }));
}
