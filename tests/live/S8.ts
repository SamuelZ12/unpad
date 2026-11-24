import assert from "node:assert/strict";
import type { CheckContext } from "./run";
import { toggle, waitForState, withBrowser } from "./lib/check";
import { assertCuts, expandRun, referenceCut, runs, sentenceTop, withBridge } from "./lib/cut";
import { save, screenshot } from "./lib/pixels";

export default async function S8(context: CheckContext) {
  return withBridge(context, () => withBrowser(context, async (browser, page) => {
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    const { root, entry, ids } = await referenceCut(context, browser, page, "wang");
    const groups = runs(ids);
    const longest = Math.max(...groups.map((group) => group.length));
    const index = groups.findIndex((group) => group.length === longest);
    await root.getByRole("button", { name: /^Show .* removed sentences?$/ }).nth(index).evaluate((marker) =>
      marker.scrollIntoView({ block: "center", behavior: "instant" }));
    await page.evaluate(() => document.fonts.ready);
    await save(context.evidence + "/wang-dark", (await screenshot(page)).png);
    const { group, remaining, top } = await expandRun(root, entry, ids, index);
    const restored = await sentenceTop(root, entry.sentences[group[0] - 1]);
    const drift = Math.abs(restored - top);
    assert.ok(drift <= 3, `Restored text starts ${drift}px from its marker`);
    await save(context.evidence + "/wang-expanded", (await screenshot(page)).png);
    await toggle(page);
    await waitForState(page, "picks-ready");
    await assertCuts(root, entry, []);
    await toggle(page);
    await waitForState(page, "faded");
    await assertCuts(root, entry, remaining);
    return `Expanded run ${group.join("/")}, ${ids.length} → ${remaining.length} removed, ${drift.toFixed(1)}px marker drift, expansion survives toggle`;
  }));
}
