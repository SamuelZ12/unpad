import assert from "node:assert/strict";
import type { CheckContext } from "./run";
import { maxMarks } from "../../src/shared/config";
import { state } from "./lib/browser";
import { toggle, waitForState, withBrowser } from "./lib/check";
import { cacheEntry, withBridge } from "./lib/fade";
import { geometry, installGeometry, regionsChanged, visible } from "./lib/geometry";
import { assertMarkedSelection, painted, settled, tintedPixels } from "./lib/marks";
import { difference, docCrop, poll, save, screenshot } from "./lib/pixels";
import { findClick } from "./lib/restore";

export default async function S17(context: CheckContext) {
  return withBridge(context, () => withBrowser(context, async (browser, page) => {
    await installGeometry(browser.context);
    let index = (await context.bridge.requests()).length;
    const logged = (await context.bridge.events()).length;
    await browser.open(page, "wang");
    await waitForState(page, "faded");
    await page.evaluate(() => document.fonts.ready);
    const shot = async (on: boolean) => {
      await settled(page, on);
      return (await screenshot(page)).png;
    };
    const response = await context.bridge.waitForRequest(index);
    const entry = await cacheEntry(context, response.cacheKey);
    const paint = await painted(page);
    const marks = assertMarkedSelection(entry, paint);
    assert.ok(paint.faded >= 3);
    const initial = await shot(true);
    await save(context.evidence + "/wang-fades-and-marks", initial);
    const layout = await geometry(page);
    assert.ok(layout.protectedText.some((box) => visible(initial, box)), "Wang title region was not found");

    const untouched = { marked: 0, faded: 0, marks: [], fades: [] };
    await page.keyboard.down("Shift");
    await waitForState(page, "revealed");
    const original = await shot(false);
    assert.deepEqual(await painted(page), untouched);
    const background = marks.map((id) => tintedPixels(original, initial, layout.sentences[id - 1]));
    assert.ok(background.every((pixels) => pixels > 100), `Marked background pixels per sentence: ${background}`);
    const titlePixels = regionsChanged(original, initial, layout.protectedText);
    assert.equal(titlePixels, 0);
    await page.keyboard.up("Shift");
    await waitForState(page, "faded");
    const refaded = await shot(true);
    assert.deepEqual(await painted(page), paint);
    assert.equal(regionsChanged(initial, refaded, layout.sentences.flat()), 0);

    await toggle(page);
    await waitForState(page, "picks-ready");
    const off = await shot(false);
    assert.deepEqual(await painted(page), untouched);
    assert.equal(regionsChanged(original, off, layout.sentences.flat()), 0);
    await toggle(page);
    await waitForState(page, "faded");
    await settled(page, true);

    const point = await findClick(page, [...marks]);
    await page.mouse.click(point.x, point.y);
    await page.mouse.click(point.x, point.y);
    const text = entry.sentences[point.id - 1];
    assert.deepEqual(await painted(page), {
      ...paint, marked: paint.marked - 1,
      marks: marks.filter((id) => id !== point.id).map((id) => entry.sentences[id - 1]).sort(),
    });
    const events = await poll(async () => (await context.bridge.events()).slice(logged),
      (rows) => rows.some((event) => event.type === "unmark"), 5000);
    const unmarks = events.filter((event) => event.type === "unmark");
    assert.equal(unmarks.length, 1);
    assert.equal(unmarks[0].cacheKey, response.cacheKey);
    assert.equal(unmarks[0].sentenceId, point.id);
    assert.equal(unmarks[0].text, text);
    assert.ok(events.some((event) => event.type === "shown" && event.cacheKey === response.cacheKey &&
      event.marks === marks.length && event.faded === paint.faded));

    index = (await context.bridge.requests()).length;
    const perfloop = await browser.open(page, "perfloop");
    await page.evaluate(() => document.fonts.ready);
    const before = await docCrop(perfloop);
    const shortResponse = await context.bridge.waitForRequest(index);
    const short = await cacheEntry(context, shortResponse.cacheKey);
    assert.equal(short.sentences.length, 10);
    assert.equal(short.key, undefined, "A short page asked for marks");
    await waitForState(page, "idle");
    assert.deepEqual(await painted(page), untouched);
    assert.equal(difference(before, await docCrop(perfloop)), 0);
    assert.equal((await state(page)).faded, 0);
    return `Wang ${entry.sentences.length} sentences, ${marks.length}/${maxMarks(entry.sentences.length)} marks and ${paint.faded} fades, 0 overlaps; ${background.join("/")} tinted background pixels per mark, ${titlePixels} changed title/byline pixels; Shift and lens off 0 marks/fades, release restores both; click leaves ${marks.length - 1} marks and ${paint.faded} fades, 1 unmark event; Perfloop 10 sentences, 0 marks/fades or changed pixels`;
  }, true, { width: 1280, height: 3700 }));
}
