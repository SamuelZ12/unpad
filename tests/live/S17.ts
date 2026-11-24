import assert from "node:assert/strict";
import type { CheckContext } from "./run";
import { cacheEntry, referenceCut, withBridge } from "./lib/cut";
import { assertMarked, marked, tintedPixels } from "./lib/marks";
import { waitForState, withBrowser } from "./lib/check";
import { poll, screenshot } from "./lib/pixels";
import { collapse } from "../../src/core/segment";

export default async function S17(context: CheckContext) {
  return withBridge(context, () => withBrowser(context, async (browser, page) => {
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    const logged = (await context.bridge.events()).length;
    const { root, entry, row, ids } = await referenceCut(context, browser, page, "wang");
    await page.evaluate(() => document.fonts.ready);
    const marks = await assertMarked(page, entry);
    const delta = marks[0].boxes[0].y - 230;
    await page.evaluate((top) => scrollBy({ top, behavior: "instant" }), delta);
    const visible = await marked(page);
    const shot = await screenshot(page);
    const tinted = tintedPixels(shot.png, visible.flatMap(({ boxes }) => boxes));
    assert.ok(tinted > 100, `Did not see yellow tint on Wang (${tinted} pixels)`);

    await page.keyboard.down("Shift");
    await waitForState(page, "revealed");
    assert.deepEqual(await marked(page), []);
    await page.keyboard.up("Shift");
    await waitForState(page, "faded");
    await assertMarked(page, entry);

    const point = await root.evaluate((root) => {
      for (const range of CSS.highlights.get("filler-cut-key") ?? []) {
        for (const { x, y, width, height } of (range as Range).getClientRects()) {
          const px = x + width * 0.5;
          const py = y + height * 0.5;
          if (py < 100 || py > innerHeight - 140 || width < 14) continue;
          const hit = document.elementFromPoint(px, py);
          if (root.contains(hit) && !hit?.closest("a, [role=link]")) return { x: px, y: py, text: range.toString() };
        }
      }
    });
    assert.ok(point, "No clickable Wang mark in view");
    await page.mouse.click(point.x, point.y);
    await page.mouse.click(point.x, point.y);
    assert.equal((await marked(page)).length, marks.length - 1);
    const events = await poll(async () => (await context.bridge.events()).slice(logged),
      (rows) => rows.some((event) => event.type === "unmark"), 5000);
    const unmarks = events.filter((event) => event.type === "unmark");
    assert.equal(unmarks.length, 1);
    assert.equal(unmarks[0].cacheKey, row.cacheKey);
    assert.equal(unmarks[0].text, collapse(point.text));
    assert.ok(events.some((event) => event.type === "shown" && event.marks === marks.length && event.faded === ids.length));

    const index = (await context.bridge.requests()).length;
    await browser.open(page, "perfloop");
    const short = await cacheEntry(context, (await context.bridge.waitForRequest(index)).cacheKey);
    assert.equal(short.key, undefined);
    assert.equal((await waitForState(page, "idle")).faded, 0);
    assert.deepEqual(await marked(page), []);
    return `Wang ${marks.length} yellow marks (${tinted} tinted pixels), hold clears tint, click removes one mark and logs one unmark; Perfloop stays untouched`;
  }));
}
