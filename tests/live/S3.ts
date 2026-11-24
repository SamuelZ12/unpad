// Open Perfloop 5 times with the lens on, clearing the cache before each load.
// All 5 runs end idle with 0 faded sentences and an untouched post.
import assert from "node:assert/strict";
import type { CheckContext } from "./run";
import { state } from "./lib/browser";
import { waitForState, withBrowser } from "./lib/check";
import { withBridge } from "./lib/cut";
import { difference, docCrop, save } from "./lib/pixels";

export default async function S3(context: CheckContext) {
  return withBridge(context, () => withBrowser(context, async (browser, page) => {
    const results: string[] = [];
    for (let attempt = 1; attempt <= 5; attempt++) {
      await context.bridge.clear();
      const index = (await context.bridge.requests()).length;
      const root = await browser.open(page, "perfloop");
      await page.evaluate(() => document.fonts.ready);
      const original = await docCrop(root);
      const row = await context.bridge.waitForRequest(index);
      assert.equal(row.source, "pi");
      await waitForState(page, row.result === "keep" ? "faded" : "idle", 5000);
      await Bun.sleep(180);
      const after = await docCrop(root);
      const changed = difference(original, after);
      await save(`${context.evidence}/perfloop-${attempt}-before`, original);
      await save(`${context.evidence}/perfloop-${attempt}-after`, after);
      const current = await state(page);
      results.push(`#${attempt} ${current.view}, ${current.faded} faded, ${changed} changed pixels, ${Math.round(row.ms)} ms`);
    }
    assert.ok(results.every((result) => result.includes("idle, 0 faded, 0 changed pixels")), results.join("; "));
    return results.join("; ");
  }));
}
