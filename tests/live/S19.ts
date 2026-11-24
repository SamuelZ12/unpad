import assert from "node:assert/strict";
import type { Locator } from "playwright";
import type { CheckContext } from "./run";
import { withActionBrowser } from "./lib/action";
import { waitForState } from "./lib/check";
import { assertCuts, cacheEntry, expandRun, pickedCuts, runs, snapshot, withBridge } from "./lib/cut";
import { assertMarked, marked } from "./lib/marks";
import { save, screenshot } from "./lib/pixels";
import { openSite } from "./lib/sites";

function widestGap(root: Locator) {
  return root.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const tops = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const { y, width } of range.getClientRects()) if (width > 0) tops.push(y);
    }
    const ordered = [...new Set(tops)].sort((a, b) => a - b);
    return Math.max(...ordered.slice(1).map((top, i) => top - ordered[i]));
  });
}

export default async function S19(context: CheckContext) {
  return withBridge(context, () => withActionBrowser(async (tabs, action) => {
    const page = tabs.pages()[0];
    await page.setViewportSize({ width: 1100, height: 900 });
    const results = [];
    for (const name of ["jessica", "greatwork"]) {
      const index = (await context.bridge.requests()).length;
      await openSite(page, `https://paulgraham.com/${name}.html`);
      const root = page.locator("td > font").filter({ hasText: /\w{4}(?:\s+\S+){150}/ }).first();
      const before = await snapshot(root);
      const originalGap = await widestGap(root);
      await save(`${context.evidence}/${name}-original`, (await screenshot(page)).png);
      await action.trigger(page);
      const cut = await waitForState(page, "faded");
      const row = await context.bridge.waitForRequest(index);
      const entry = await cacheEntry(context, row.cacheKey);
      assert.equal(entry.check, undefined, "Expected page mode");
      const ids = pickedCuts(entry);
      assert.ok(ids.length > 0 && ids.length === cut.faded);
      await assertCuts(root, entry, ids);
      const marks = await assertMarked(page, entry);
      const after = await snapshot(root);
      assert.ok(after.height < before.height);
      const gap = await widestGap(root);
      assert.ok(gap <= originalGap + 2, `${name} gained a blank gap (${gap}px vs ${originalGap}px)`);
      await root.locator("[data-filler-cut-marker]").first().scrollIntoViewIfNeeded();
      await save(`${context.evidence}/${name}-cut`, (await screenshot(page)).png);
      const multi = runs(ids).findIndex((group) => group.length > 1);
      const { group } = await expandRun(root, entry, ids, Math.max(0, multi));
      await assertMarked(page, entry);
      await action.trigger(page);
      await waitForState(page, "picks-ready");
      const off = await snapshot(root);
      assert.equal(off.text, before.text, `${name}: text differs off`);
      assert.equal(off.html, before.html, `${name}: element structure differs off`);
      assert.deepEqual(await marked(page), []);
      results.push(`${name} ${ids.length} removed, ${marks.length} marks, ${before.height - after.height}px shorter, max gap ${gap}px (original ${originalGap}px), expanded ${group.length}, exact original off`);
    }
    return results.join(" | ");
  }));
}
