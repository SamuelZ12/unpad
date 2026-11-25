import assert from "node:assert/strict";
import type { CheckContext } from "./run";
import { extensionWorker, withActionBrowser } from "./lib/action";
import { waitForState } from "./lib/check";
import { assertCuts, cacheEntry, pickedCuts, proseHtml, withBridge } from "./lib/cut";
import { marked } from "./lib/marks";
import { poll, save, screenshot } from "./lib/pixels";
import { activeBadge, articleUrl, assertUninjected, grants, openSite, registrations } from "./lib/sites";

export default async function S12PageMode(context: CheckContext) {
  return withBridge(context, () => withActionBrowser(async (tabs, action) => {
    const page = tabs.pages()[0];
    const worker = await extensionWorker(tabs);
    const storage = { lensOn: false };
    await worker.evaluate((storage) => chrome.storage.local.set(storage), storage);
    const before = await grants(worker);
    const scripts = await registrations(worker);
    const cursor = (await context.bridge.requests()).length;
    const logged = (await context.bridge.events()).length;
    await openSite(page, articleUrl);
    await assertUninjected(page);
    const editor = await page.evaluateHandle(() => {
      const input = document.createElement("input");
      input.style.position = "fixed";
      document.body.append(input);
      input.focus({ preventScroll: true });
      return input;
    });
    await action.press(page);
    await Bun.sleep(200);
    await assertUninjected(page);
    assert.equal((await context.bridge.requests()).length, cursor);
    await editor.evaluate((input) => input.remove());
    await page.evaluate(() => document.fonts.ready);
    const root = page.locator("main article, main").last();
    const originalDoc = await proseHtml(root);
    const original = (await screenshot(page)).png;
    await save(context.evidence + "/page-mode-original", original);

    await action.press(page);
    const faded = await waitForState(page, "faded");
    const response = await context.bridge.waitForRequest(cursor);
    const entry = await cacheEntry(context, response.cacheKey);
    assert.equal(entry.check, undefined);
    const selected = pickedCuts(entry);
    await assertCuts(root, entry);
    assert.equal(faded.faded, selected.length);
    const painted = (await screenshot(page)).png;
    await save(context.evidence + "/page-mode-faded", painted);
    await action.press(page);
    assert.equal((await waitForState(page, "picks-ready")).faded, 0);
    await poll(() => activeBadge(worker), (badge) => badge === "", 3000);
    assert.deepEqual(await marked(page), []);
    await assertCuts(root, entry, []);
    const off = (await screenshot(page)).png;
    await save(context.evidence + "/page-mode-off", off);
    assert.deepEqual(await proseHtml(root), originalDoc);

    await action.press(page);
    assert.deepEqual(await waitForState(page, "faded"), faded);
    await page.evaluate(() => history.replaceState(history.state, "", "#" + document.querySelector("[id]:not([id*='%'])")!.id));
    await Bun.sleep(150);
    assert.deepEqual(await waitForState(page, "faded", 1000), faded);
    // A hash route is a new page. It needs its own key press.
    await page.evaluate(() => history.replaceState(history.state, "", "#/filler-cut/other-route"));
    await poll(() => page.evaluate(() => document.documentElement.dataset.fillerCutFaded), (count) => count === "0", 2000);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts.ready);
    const reload = await proseHtml(root);
    await Bun.sleep(500);
    const reloadAfter = (await screenshot(page)).png;
    await save(context.evidence + "/page-mode-reloaded", reloadAfter);
    await assertUninjected(page);
    assert.deepEqual(await proseHtml(root), reload);
    assert.deepEqual(await grants(worker), before);
    assert.deepEqual(await registrations(worker), scripts);
    // The page's events are queued and sent like any other. Nothing else is stored.
    const shown = await poll(async () => (await context.bridge.events()).slice(logged), (events) =>
      events.some((event) => event.type === "shown" && event.url.includes("building-effective-agents")), 5000);
    assert.equal(shown.filter((event) => event.type === "shown" && event.url.includes("building-effective-agents")).length, 1);
    const { pendingEvents = [], ...stored } = await worker.evaluate(() => chrome.storage.local.get(null));
    assert.deepEqual(stored, storage);
    assert.deepEqual(pendingEvents, []);
    assert.equal((await context.bridge.requests()).slice(cursor).filter(({ path }) => path === "/select").length, 1);
    return `${faded.faded}/${entry.sentences.length} removed, same after a fragment change; editor, off, and reload 0 cuts; original HTML restored off; 1 select, 1 shown event, 0 grants, registrations, or storage changes`;
  }));
}
