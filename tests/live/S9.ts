import assert from "node:assert/strict";
import type { CheckContext } from "./run";
import { urls } from "./lib/browser";
import { atMost, waitForState, withBrowser } from "./lib/check";
import { poll } from "./lib/pixels";
import { findClick, restoreOne } from "./lib/restore";

export default async function S9(context: CheckContext) {
  await context.bridge.start();
  try {
    return await withBrowser(context, async (browser, page) => {
      const from = (await context.bridge.events()).length;
      const read = async () => (await context.bridge.events()).slice(from);
      const { point, first, faded, entry, clickAt } = await restoreOne(context, browser, page, false);
      const initial = await poll(read, (events) => events.some((event) => event.type === "restore"), 5000);
      const restore = initial.filter((event) => event.type === "restore");
      const shown = initial.filter((event) => event.type === "shown");
      assert.equal(restore.length, 1);
      assert.equal(shown.length, 1);
      assert.equal(restore[0].text, entry.sentences[point.id - 1]);
      assert.equal(restore[0].url, urls.wang);
      assert.equal(restore[0].cacheKey, entry.cacheKey);
      assert.equal(shown[0].pageView, restore[0].pageView);
      assert.equal(shown[0].total, entry.sentences.length);
      assert.equal(shown[0].faded, first.faded);
      assert.ok(clickAt > 0);
      const logMs = Date.now() - clickAt;
      atMost(logMs, 5000, "Click to restore log");

      await page.mouse.click(point.x, point.y);
      await Bun.sleep(250);
      assert.equal((await read()).filter((event) => event.type === "restore").length, 1);

      await context.bridge.stop();
      const second = await findClick(page, faded.filter((id) => id !== point.id));
      await page.mouse.click(second.x, second.y);
      const worker = browser.context.serviceWorkers()[0];
      await poll(() => worker.evaluate(async () => {
        const { pendingEvents } = await chrome.storage.local.get("pendingEvents");
        return pendingEvents as { type: string }[] | undefined;
      }), (events) => !!events?.some((event) => event.type === "restore"), 5000);
      assert.equal((await read()).filter((event) => event.type === "restore").length, 1);

      await context.bridge.start();
      await page.keyboard.down("Shift");
      await waitForState(page, "revealed", 1000);
      const restartAt = Date.now();
      await page.keyboard.up("Shift");
      const flushed = await poll(read, (events) => events.some((event) => event.type === "reveal"), 5000);
      const retryMs = Date.now() - restartAt;
      const retries = flushed.filter((event) => event.type === "restore");
      assert.deepEqual(retries.map((event) => event.sentenceId), [point.id, second.id]);
      assert.equal(retries[1].text, entry.sentences[second.id - 1]);
      assert.equal(flushed.filter((event) => event.type === "shown").length, 1);
      return `1 shown (${shown[0].faded}/${shown[0].total}), first restore logged in ${logMs.toFixed(1)} ms, repeat added 0 events, offline restore delivered ${retryMs} ms after next event`;
    });
  } finally {
    await context.bridge.stop();
  }
}
