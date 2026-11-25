import assert from "node:assert/strict";
import type { CheckContext } from "./run";
import { extensionWorker, addFromPopup, withActionBrowser } from "./lib/action";
import { waitForState } from "./lib/check";
import { assertCuts, cacheEntry, pickedCuts, proseHtml, withBridge } from "./lib/cut";
import { marked } from "./lib/marks";
import { poll, save, screenshot } from "./lib/pixels";
import { activeBadge, articleUrl, assertUninjected, grants, openSite, registrations } from "./lib/sites";

export default async function S12AddedSite(context: CheckContext) {
  return withBridge(context, () => withActionBrowser(async (tabs, action) => {
    const page = tabs.pages()[0];
    const worker = await extensionWorker(tabs);
    await worker.evaluate(() => chrome.storage.local.set({ lensOn: false }));
    const setting = (target: typeof page, checked: boolean, enabled: boolean) =>
      action.withPopup(target, async (popup) => {
        const box = popup.locator("#always");
        await box.waitFor({ state: "visible", timeout: 5000 });
        assert.equal(await box.isChecked(), checked);
        assert.equal(await box.isEnabled(), enabled);
        if (checked && enabled) await popup.getByRole("button", { name: /Remove/ }).waitFor({ timeout: 5000 });
      });
    const index = (await context.bridge.requests()).length;
    const before = await grants(worker);
    await openSite(page, articleUrl);
    await assertUninjected(page);
    await setting(page, false, true);
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    const match = await addFromPopup(page, action);
    assert.equal(await page.evaluate(() => performance.timeOrigin), timeOrigin);
    assert.deepEqual(await grants(worker), [...before, match].sort());
    const faded = await waitForState(page, "faded");
    assert.deepEqual(await registrations(worker), [match]);
    await setting(page, true, true);
    assert.deepEqual(await worker.evaluate(() => chrome.storage.local.get("lensOn")), { lensOn: true });
    const first = await context.bridge.waitForRequest(index);
    const entry = await cacheEntry(context, first.cacheKey);
    const selected = pickedCuts(entry);
    const root = page.locator("main article, main").last();
    await assertCuts(root, entry);
    assert.equal(faded.faded, selected.length);
    await page.evaluate(() => document.fonts.ready);
    const painted = (await screenshot(page)).png;
    await save(context.evidence + "/added-site-faded", painted);
    await action.press(page);
    assert.equal((await waitForState(page, "picks-ready")).faded, 0);
    const original = (await screenshot(page)).png;
    await save(context.evidence + "/added-site-original", original);
    await action.press(page);
    assert.deepEqual(await waitForState(page, "faded"), faded);

    await page.reload({ waitUntil: "domcontentloaded" });
    assert.deepEqual(await waitForState(page, "faded"), faded);
    const reload = await context.bridge.waitForRequest(index + 1);
    assert.equal(reload.source, "cache");
    assert.equal(reload.cacheKey, first.cacheKey);

    const other = await tabs.newPage();
    await openSite(other, "https://example.com/");
    await setting(other, false, true);
    await setting(page, true, true);

    await page.evaluate(() => document.fonts.ready);
    await action.press(page);
    await waitForState(page, "picks-ready");
    const restored = await proseHtml(root);
    const reloadOriginal = (await screenshot(page)).png;
    await save(context.evidence + "/added-site-reload-original", reloadOriginal);
    await action.press(page);
    await waitForState(page, "faded");
    // Remove from a different tab to test the Runs on list and restore the open article.
    await action.withPopup(other, async (popup) => {
      const remove = popup.getByRole("button", { name: "Remove www.anthropic.com" });
      await remove.click({ timeout: 5000 });
      await remove.waitFor({ state: "hidden", timeout: 5000 });
    });
    await setting(page, false, true);
    assert.deepEqual(await grants(worker), before);
    assert.deepEqual(await registrations(worker), []);
    assert.equal((await waitForState(page, "idle")).faded, 0);
    assert.deepEqual(await marked(page), []);
    await assertCuts(root, entry, []);
    await poll(() => activeBadge(worker), (badge) => badge === "", 3000);
    const removed = (await screenshot(page)).png;
    await save(context.evidence + "/added-site-removed", removed);
    assert.deepEqual(await proseHtml(root), restored, "Removing access changed prose HTML");
    await page.reload({ waitUntil: "domcontentloaded" });
    await Bun.sleep(500);
    await assertUninjected(page);
    assert.equal((await context.bridge.requests()).length - index, 2);

    await other.bringToFront();
    await openSite(other, "https://claude.com/");
    assert.equal(new URL(other.url()).hostname, "claude.com");
    await setting(other, true, false);
    return `${match} granted and registered; ${faded.faded}/${entry.sentences.length} removed on add and on reload; 2 selects, second a cache hit; removal restored original HTML and reload sent 0 selects; popup checkbox matched added, other, and built-in tabs`;
  }));
}
