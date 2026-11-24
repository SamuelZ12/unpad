import assert from "node:assert/strict";
import type { CheckContext } from "./run";
import { atMost, toggle, trace, waitForState, withBrowser } from "./lib/check";
import { cacheEntry, pickedFades, withBridge } from "./lib/fade";
import { changedSentences, geometry, installGeometry } from "./lib/geometry";
import { save, screenshot } from "./lib/pixels";

export default async function S7(context: CheckContext) {
  return withBridge(context, () => withBrowser(context, async (browser, page) => {
    await installGeometry(browser.context);
    const index = (await context.bridge.requests()).length;
    await browser.open(page, "wang");
    const originalState = await waitForState(page, "faded");
    await page.evaluate(() => document.fonts.ready);
    const row = await context.bridge.waitForRequest(index);
    const ids = pickedFades(await cacheEntry(context, row.cacheKey));
    const layout = await geometry(page);
    const middle = Math.floor(layout.sentences.length / 2);
    const kept = layout.sentences.map((_, i) => i).filter((i) => !ids.includes(i + 1))
      .sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle))[0];
    const top = layout.sentences[kept][0].y;
    await page.evaluate((y) => window.scrollBy(0, y - 420), top);

    const position = async () => ({
      scroll: await page.evaluate(() => scrollY),
      top: (await geometry(page)).sentences[kept][0].y,
    });
    await toggle(page);
    await waitForState(page, "picks-ready");
    await Bun.sleep(180);
    const original = await screenshot(page);
    await toggle(page);
    await waitForState(page, "faded");
    await Bun.sleep(180);

    const before = await position();
    const faded = await screenshot(page);
    const countBefore = (await trace(page)).length;
    await page.keyboard.down("Shift");
    const holdAt = Date.now();
    await waitForState(page, "revealed", 1000);
    await Bun.sleep(180);
    const revealed = await screenshot(page);
    const during = await position();
    await Bun.sleep(Math.max(0, holdAt + 1000 - Date.now()));
    await page.evaluate(() => window.addEventListener("keyup", (event) => {
      document.documentElement.dataset.verifyKeyAt = String(performance.timeOrigin + event.timeStamp);
    }, { capture: true, once: true }));
    await page.keyboard.up("Shift");
    assert.deepEqual(await waitForState(page, "faded", 1000), originalState);
    const releaseAt = Number(await page.locator("html").getAttribute("data-verify-key-at"));
    const releasedIn = (await trace(page)).at(-1)!.at - releaseAt;
    await Bun.sleep(180);
    const refaded = await screenshot(page);
    const after = await position();
    const visible = await geometry(page);
    await Promise.all([["original", original], ["faded", faded], ["held", revealed], ["released", refaded]]
      .map(([label, frame]) => save(context.evidence + "/" + label, (frame as typeof original).png)));
    assert.deepEqual(changedSentences(original.png, revealed.png, visible, 0), []);
    assert.deepEqual(changedSentences(faded.png, refaded.png, visible, 0), []);
    assert.ok(changedSentences(original.png, faded.png, visible).length > 0, "No changed sentence visible in the middle");
    const scrollDrift = Math.max(before.scroll, during.scroll, after.scroll) - Math.min(before.scroll, during.scroll, after.scroll);
    const topDrift = Math.max(before.top, during.top, after.top) - Math.min(before.top, during.top, after.top);
    assert.ok(scrollDrift < 1 && topDrift < 1, `scroll drift ${scrollDrift}px, kept sentence drift ${topDrift}px`);
    assert.ok(releaseAt > 0);
    atMost(releasedIn, 100, "Release to faded state");
    await page.keyboard.down("Shift");
    await Bun.sleep(125);
    await page.keyboard.up("Shift");
    await Bun.sleep(225);
    assert.deepEqual((await trace(page)).slice(countBefore).map(({ view }) => view), ["revealed", "faded"]);
    return `scroll drift ${scrollDrift.toFixed(2)} px, kept sentence drift ${topDrift.toFixed(2)} px, release ${releasedIn.toFixed(1)} ms, short press added 0 transitions`;
  }));
}
