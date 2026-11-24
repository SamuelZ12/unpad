import assert from "node:assert/strict";
import type { CheckContext } from "./run";
import { toggle, waitForState, withBrowser } from "./lib/check";
import { assertCuts, referenceCut, snapshot, withBridge } from "./lib/cut";

export default async function S6(context: CheckContext) {
  return withBridge(context, () => withBrowser(context, async (browser, page) => {
    const warp = await browser.context.newPage();
    const blog = await referenceCut(context, browser, warp, "warp");
    const wang = await referenceCut(context, browser, page, "wang");
    const before = await snapshot(wang.root);
    await toggle(page);
    for (const [tab, doc] of [[page, wang], [warp, blog]] as const) {
      await waitForState(tab, "picks-ready");
      await assertCuts(doc.root, doc.entry, []);
    }
    await toggle(page);
    for (const [tab, doc] of [[page, wang], [warp, blog]] as const) {
      await waitForState(tab, "faded");
      await assertCuts(doc.root, doc.entry);
    }
    assert.equal((await snapshot(wang.root)).text, before.text);
    return "Wang and Warp both return to full text with the lens off and recut in the existing tabs";
  }));
}
