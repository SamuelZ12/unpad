import assert from "node:assert/strict";
import type { Page } from "playwright";
import type { CheckContext } from "./run";
import { atMost, toggle, trace, waitForState, withBrowser } from "./lib/check";
import { withBridge } from "./lib/fade";
import { changedSentences, geometry, installGeometry } from "./lib/geometry";
import { save, screenshot } from "./lib/pixels";


async function press(page: Page, next: "faded" | "picks-ready") {
  await page.evaluate(() => {
    function record(event: KeyboardEvent) {
      if (event.code !== "KeyF") return;
      window.removeEventListener("keydown", record, true);
      document.documentElement.dataset.verifyKeyAt = String(performance.timeOrigin + event.timeStamp);
    }
    window.addEventListener("keydown", record, true);
  });
  await toggle(page);
  await waitForState(page, next, 2500);
  const at = Number(await page.locator("html").getAttribute("data-verify-key-at"));
  assert.ok(at > 0, "keydown timestamp missing");
  return (await trace(page)).at(-1)!.at - at;
}

export default async function S6(context: CheckContext) {
  return withBridge(context, () => withBrowser(context, async (browser, page) => {
    const warp = await browser.context.newPage();
    await browser.open(warp, "warp");
    await waitForState(warp, "faded");
    await installGeometry(browser.context);
    await page.setViewportSize({ width: 1280, height: 3700 });
    await browser.open(page, "wang");
    await waitForState(page, "faded");
    await page.waitForLoadState("load", { timeout: 12_000 }).catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    await Bun.sleep(180);
    const layout = await geometry(page);
    const a = (await screenshot(page)).png;
    const off = await press(page, "picks-ready");
    await waitForState(warp, "picks-ready", 5000);
    await Bun.sleep(180);
    const b = (await screenshot(page)).png;
    const on = await press(page, "faded");
    await waitForState(warp, "faded", 5000);
    await Bun.sleep(180);
    const c = (await screenshot(page)).png;
    assert.deepEqual(changedSentences(a, c, layout), [], "C differs from A");
    // One more untouched crop supplies the reference in this page load.
    await press(page, "picks-ready");
    await Bun.sleep(180);
    const original = (await screenshot(page)).png;
    await Promise.all(([["A", a], ["B", b], ["C", c], ["original", original]] as const).map(([label, png]) =>
      save(`${context.evidence}/${label}`, png)));
    assert.deepEqual(changedSentences(b, original, layout), [], "B differs from the untouched crop");
    const changed = changedSentences(a, b, layout);
    assert.ok(changed.length > 0, "A and B have identical sentence pixels");
    atMost(off, 100, "Toggle off state");
    atMost(on, 100, "Toggle on state");
    return `off ${off.toFixed(1)} ms, on ${on.toFixed(1)} ms, A/C and B/original identical, ${changed.length} sentences differed in A/B, Warp followed both toggles`;
  }));
}
