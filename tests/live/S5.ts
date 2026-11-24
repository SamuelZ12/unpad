import assert from "node:assert/strict";
import type { Locator } from "playwright";
import type { CheckContext } from "./run";
import { state } from "./lib/browser";
import { toggle, waitForState, withBrowser } from "./lib/check";
import { referenceCut, withBridge } from "./lib/cut";
import { difference, docCrop, save } from "./lib/pixels";

async function untouched(root: Locator, path: string, duration: number, press = false) {
  const page = root.page();
  const baseline = await docCrop(root);
  await save(path + "-before", baseline);
  const start = Date.now();
  let maxChanged = 0;
  let count = 0;
  do {
    const at = Date.now();
    const frame = await docCrop(root);
    maxChanged = Math.max(maxChanged, difference(baseline, frame));
    const current = await state(page);
    assert.ok(["idle", "waiting"].includes(current.view ?? "") && current.faded === 0, JSON.stringify(current));
    count++;
    await Bun.sleep(Math.max(0, at + 50 - Date.now()));
  } while (Date.now() - start < duration);
  if (press) {
    for (let i = 0; i < 2; i++) {
      await toggle(page);
      maxChanged = Math.max(maxChanged, difference(baseline, await docCrop(root)));
      assert.ok(["idle", "waiting"].includes((await state(page)).view ?? ""));
      count++;
    }
  }
  await save(path + "-after", await docCrop(root));
  assert.equal(maxChanged, 0, `${path}: ${maxChanged} changed pixels in ${count} samples`);
  return `${count} crops, ${maxChanged} changed pixels`;
}

export default async function S5(context: CheckContext) {
  const { bridge, evidence } = context;
  await bridge.stop();
  return withBrowser(context, async (browser, page) => {
    const root = await browser.open(page, "wang");
    await page.evaluate(() => document.fonts.ready);
    const offline = await untouched(root, evidence + "/offline", 10_000, true);
    const recovered = await withBridge(context, () => referenceCut(context, browser, page, "wang"));
    await page.setViewportSize({ width: 1280, height: 900 });
    await bridge.clear();
    const index = (await bridge.requests()).length;
    await bridge.start(true);
    try {
      await browser.open(page, "wang");
      const invalid = await bridge.waitForRequest(index);
      assert.equal(invalid.piCalls, 3); // Two keep attempts and one key attempt.
      assert.match(invalid.error ?? "", /invalid selection twice/);
      await waitForState(page, "idle");
      const rejected = await untouched(root, evidence + "/invalid", 500);
      return `offline ${offline}; restart ${recovered.ids.length} removed; invalid ${rejected}, ${invalid.piCalls} attempts, idle`;
    } finally {
      await bridge.stop();
    }
  });
}
