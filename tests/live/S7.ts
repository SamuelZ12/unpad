import assert from "node:assert/strict";
import type { CheckContext } from "./run";
import { toggle, trace, waitForState, withBrowser } from "./lib/check";
import { assertCuts, referenceCut, sentenceTop, snapshot, withBridge } from "./lib/cut";
import { save, screenshot } from "./lib/pixels";

export default async function S7(context: CheckContext) {
  return withBridge(context, () => withBrowser(context, async (browser, page) => {
    const { root, entry, ids } = await referenceCut(context, browser, page, "wang");
    await page.evaluate(() => document.fonts.ready);
    const target = entry.sentences.find((text, i) => i >= 12 && !ids.includes(i + 1) && /^\w{12}/.test(text.replace(" ", "")))
      ?? entry.sentences.find((_, i) => i >= 12 && !ids.includes(i + 1))!;
    const top = await sentenceTop(root, target);
    const move = top - 180;
    await page.evaluate((y) => scrollBy({ top: y, behavior: "instant" }), move);
    const before = await sentenceTop(root, target);
    assert.ok(Math.abs(before - 180) <= 1, `Could not position the kept sentence (${before}px)`);
    const shown = await snapshot(root);

    await page.keyboard.down("Shift");
    await waitForState(page, "revealed", 1000);
    await assertCuts(root, entry, []);
    const during = await sentenceTop(root, target);
    await save(context.evidence + "/held", (await screenshot(page)).png);
    await page.keyboard.up("Shift");
    await waitForState(page, "faded", 1000);
    await assertCuts(root, entry);
    const after = await sentenceTop(root, target);
    assert.equal((await snapshot(root)).text, shown.text);

    await toggle(page);
    await waitForState(page, "picks-ready");
    const off = await sentenceTop(root, target);
    await toggle(page);
    await waitForState(page, "faded");
    const on = await sentenceTop(root, target);
    const drift = Math.max(before, during, after, off, on) - Math.min(before, during, after, off, on);
    assert.ok(drift <= 1, `Kept sentence drifted ${drift}px across ${[before, during, after, off, on].join("/")}`);
    const count = (await trace(page)).length;
    await page.keyboard.press("Shift", { delay: 60 });
    assert.equal((await trace(page)).length, count);
    return `Full text during Shift hold, recut on release, ${drift}px kept-sentence drift across hold and lens toggles, short press unchanged`;
  }));
}
