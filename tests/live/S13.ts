import assert from "node:assert/strict";
import type { CheckContext } from "./run";
import { toggle, waitForState, withBrowser } from "./lib/check";
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
      assert.equal(await badge(blankId), "");
    } finally {
      pending.resolve();
    }
    await waitForState(page, "idle");
    await expectBadge("!");
    await bridge.stop();

    await bridge.warmCache();
    await bridge.start();
    await browser.open(page, "wang");
    const faded = await waitForState(page, "faded");
    await expectBadge(String(faded.faded));
    await toggle(page);
    assert.equal((await waitForState(page, "picks-ready")).faded, 0);
    await expectBadge(String(faded.faded));
    assert.equal(await badge(blankId), "");
    await page.goto("about:blank#after-wang");
    await expectBadge("");
    return `waiting "…", failed "!", faded and picks-ready "${faded.faded}", untouched "" in both tabs`;
  }).finally(() => bridge.stop());
}
