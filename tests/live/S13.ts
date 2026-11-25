// Read the badge from the service worker for the active tab. It shows … for
// pending picks, the faded sentence count for faded or picks-ready, nothing
// for an untouched page, and ! when the bridge fails.
import assert from "node:assert/strict";
import type { CheckContext } from "./run";
import { toggle, waitForState, withBrowser } from "./lib/check";
import { assertCuts, cacheEntry, expandRun, pickedCuts } from "./lib/cut";
import { poll } from "./lib/pixels";

export default async function S13(context: CheckContext) {
  const { bridge } = context;
  return withBrowser(context, async (browser, page) => {
    const worker = browser.context.serviceWorkers()[0] ??
      await browser.context.waitForEvent("serviceworker", { timeout: 5000 });
    const blank = await browser.context.newPage();
    await blank.goto("about:blank#untouched");
    const activeTab = () => worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id === undefined) throw new Error("No active tab");
      return tab.id;
    });
    const blankId = await activeTab();
    await page.bringToFront();
    const wangId = await activeTab();
    assert.notEqual(wangId, blankId);
    const badge = (tabId: number) => worker.evaluate((tabId) => chrome.action.getBadgeText({ tabId }), tabId);
    const expectBadge = (text: string) => poll(() => badge(wangId), (value) => value === text, 3000);

    await bridge.clear();
    const pending = Promise.withResolvers<void>();
    await bridge.start(true, pending.promise);
    try {
      await browser.open(page, "wang");
      await waitForState(page, "waiting");
      await expectBadge("…");
      assert.equal(await page.locator("filler-cut-toast").count(), 0);
      assert.equal(await badge(blankId), "");
    } finally {
      pending.resolve();
    }
    await waitForState(page, "idle");
    await expectBadge("!");
    assert.equal(await page.locator("filler-cut-toast").count(), 0);
    await toggle(page);
    const failure = page.locator("filler-cut-toast").getByRole("status");
    await failure.getByText("Couldn't get cuts for this page").waitFor({ timeout: 3000 });
    assert.equal(await failure.innerText(), "Couldn't get cuts for this page");
    await bridge.stop();

    await bridge.warmCache();
    await bridge.start();
    const index = (await bridge.requests()).length;
    const root = await browser.open(page, "wang");
    const faded = await waitForState(page, "faded");
    await expectBadge(String(faded.faded));
    const row = await bridge.waitForRequest(index);
    const entry = await cacheEntry(context, row.cacheKey);
    const { remaining } = await expandRun(root, entry, pickedCuts(entry));
    const reduced = remaining.length ? String(remaining.length) : "";
    await expectBadge(reduced);
    await toggle(page);
    assert.equal((await waitForState(page, "picks-ready")).faded, 0);
    await assertCuts(root, entry, []);
    await expectBadge(reduced);
    assert.equal(await badge(blankId), "");
    await page.goto("about:blank#after-wang");
    await expectBadge("");

    // A press while picks are pending waits for them, then turns the lens on.
    await worker.evaluate(() => chrome.storage.local.set({ lensOn: false }));
    await bridge.clear();
    await browser.open(page, "wang");
    await waitForState(page, "waiting");
    await toggle(page);
    const pressed = await waitForState(page, "faded");
    assert.deepEqual(await worker.evaluate(() => chrome.storage.local.get("lensOn")), { lensOn: true });
    return `waiting "…", failed "!", cut "${faded.faded}", after expansion and lens off "${reduced}", untouched "" in both tabs; a press during a cold selection turned the lens on and cut ${pressed.faded}`;
  }).finally(() => bridge.stop());
}
