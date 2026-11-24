import assert from "node:assert/strict";
import type { CheckContext } from "./run";
import { urls } from "./lib/browser";
import { waitForState, withBrowser } from "./lib/check";
import { expandRun, referenceCut, runs, withBridge } from "./lib/cut";
import { poll } from "./lib/pixels";

export default async function S9(context: CheckContext) {
  return withBridge(context, () => withBrowser(context, async (browser, page) => {
    const cursor = (await context.bridge.events()).length;
    const { root, entry, row, ids } = await referenceCut(context, browser, page, "wang");
    const read = async () => (await context.bridge.events()).slice(cursor);
    const events = await poll(read, (rows) => rows.some(({ type }) => type === "shown"), 5000);
    const shown = events.find((event) => event.type === "shown");
    assert.equal(shown?.faded, ids.length);
    await context.bridge.stop();
    const { group } = await expandRun(root, entry, ids);
    assert.equal((await read()).filter(({ type }) => type === "restore").length, 0);
    await context.bridge.start();
    // A subsequent reader action flushes the queued expansion.
    await page.keyboard.down("Shift");
    await waitForState(page, "revealed", 1000);
    await page.keyboard.up("Shift");
    const restored = await poll(read, (rows) => rows.filter(({ type }) => type === "restore").length >= group.length, 5000);
    const clicks = restored.filter((event) => event.type === "restore");
    assert.deepEqual(clicks.map(({ sentenceId }) => sentenceId).sort((a, b) => a - b), group);
    assert.ok(clicks.every((event) =>
      event.url === urls.wang && event.cacheKey === row.cacheKey && event.pageView === shown?.pageView &&
      event.text === entry.sentences[event.sentenceId - 1]));
    assert.equal(restored.filter(({ type }) => type === "shown").length, 1);
    return `1 shown, ${runs(ids).length} initial runs, ${clicks.length} restore events delivered after bridge restart`;
  }));
}
