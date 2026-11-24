import assert from "node:assert/strict";
import type { CheckContext } from "./run";
import { extensionWorker, setAlwaysRun, withActionBrowser } from "./lib/action";
import { waitForState } from "./lib/check";
import { assertCuts, cacheEntry, pickedCuts, proseHtml, withBridge } from "./lib/cut";
import { marked } from "./lib/marks";
import { poll, save, screenshot } from "./lib/pixels";
import { activeBadge, articleUrl, assertUninjected, grants, openSite, registrations } from "./lib/sites";

export default async function S12AddedSite(context: CheckContext) {
  return withBridge(context, () => withActionBrowser(async (tabs, action) => {
    const page = tabs.pages()[0];
    const worker = await extensionWorker(tabs);
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ lensOn: false });
      const update = chrome.contextMenus.update.bind(chrome.contextMenus);
      type MenuProps = Parameters<typeof update>[1];
      const probe = Object.assign(globalThis, { siteMenu: undefined as MenuProps | undefined });
      chrome.contextMenus.update = ((id: string | number, props: MenuProps) => {
        if (id === "always-run") probe.siteMenu = props;
        return update(id, props);
      }) as typeof chrome.contextMenus.update;
    });
    const menu = () => worker.evaluate(() =>
      (globalThis as unknown as { siteMenu: { checked: boolean; enabled: boolean } }).siteMenu);
    const index = (await context.bridge.requests()).length;
    const before = await grants(worker);
    await openSite(page, articleUrl);
    await assertUninjected(page);
    await poll(menu, (state) => state?.checked === false && state.enabled, 3000);
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    const match = await setAlwaysRun(page, true, action);
    assert.equal(await page.evaluate(() => performance.timeOrigin), timeOrigin);
    assert.deepEqual(await grants(worker), [...before, match].sort());
    assert.deepEqual(await registrations(worker), [match]);
    assert.deepEqual(await menu(), { checked: true, enabled: true });
    assert.deepEqual(await worker.evaluate(() => chrome.storage.local.get("lensOn")), { lensOn: true });
    const faded = await waitForState(page, "faded");
    const first = await context.bridge.waitForRequest(index);
    const entry = await cacheEntry(context, first.cacheKey);
    const selected = pickedCuts(entry);
    const root = page.locator("main article, main").last();
    await assertCuts(root, entry);
    assert.equal(faded.faded, selected.length);
    await page.evaluate(() => document.fonts.ready);
    const painted = (await screenshot(page)).png;
    await save(context.evidence + "/added-site-faded", painted);
    await action.trigger(page);
    assert.equal((await waitForState(page, "picks-ready")).faded, 0);
    const original = (await screenshot(page)).png;
    await save(context.evidence + "/added-site-original", original);
    await action.trigger(page);
    assert.deepEqual(await waitForState(page, "faded"), faded);

    await page.reload({ waitUntil: "domcontentloaded" });
    assert.deepEqual(await waitForState(page, "faded"), faded);
    const reload = await context.bridge.waitForRequest(index + 1);
    assert.equal(reload.source, "cache");
    assert.equal(reload.cacheKey, first.cacheKey);

    const other = await tabs.newPage();
    await openSite(other, "https://example.com/");
    await poll(menu, (state) => state?.checked === false && state.enabled, 3000);
    await page.bringToFront();
    await poll(menu, (state) => state?.checked === true && state.enabled, 3000);

    await page.evaluate(() => document.fonts.ready);
    await action.trigger(page);
    await waitForState(page, "picks-ready");
    const restored = await proseHtml(root);
    const reloadOriginal = (await screenshot(page)).png;
    await save(context.evidence + "/added-site-reload-original", reloadOriginal);
    await action.trigger(page);
    await waitForState(page, "faded");
    await setAlwaysRun(page, false, action);
    assert.deepEqual(await menu(), { checked: false, enabled: true });
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
    await poll(menu, (state) => state?.checked === true && !state.enabled, 3000);
    return `${match} granted and registered; ${faded.faded}/${entry.sentences.length} removed on add and on reload; 2 selects, second a cache hit; removal restored original HTML and reload sent 0 selects; menu update calls matched added, other, and built-in tabs`;
  }));
}
