import assert from "node:assert/strict";
import type { CheckContext } from "./run";
import { extensionWorker, withActionBrowser } from "./lib/action";
import { waitForState } from "./lib/check";
import { cacheEntry, pickedFades, withBridge } from "./lib/fade";
import { changedSentences, geometry, installGeometry, regionsChanged } from "./lib/geometry";
import { poll, save, screenshot } from "./lib/pixels";
import { activeBadge, articleUrl, assertUninjected, grants, openSite, registrations } from "./lib/sites";

export default async function S12PageMode(context: CheckContext) {
  return withBridge(context, () => withActionBrowser(async (tabs, action) => {
    const page = tabs.pages()[0];
    const worker = await extensionWorker(tabs);
    await installGeometry(tabs);
    const storage = { lensOn: false };
    await worker.evaluate(async (storage) => {
      await chrome.storage.local.set(storage);
      const request = chrome.permissions.request.bind(chrome.permissions);
      const probe = Object.assign(globalThis, { permissionRequests: 0 });
      chrome.permissions.request = ((permission: chrome.permissions.Permissions) => {
        probe.permissionRequests++;
        return request(permission);
      }) as typeof chrome.permissions.request;
    }, storage);
    const before = await grants(worker);
    const scripts = await registrations(worker);
    const cursor = (await context.bridge.requests()).length;
    await openSite(page, articleUrl);
    await assertUninjected(page);
    const editor = await page.evaluateHandle(() => {
      const input = document.createElement("input");
      input.style.position = "fixed";
      document.body.append(input);
      input.focus({ preventScroll: true });
      return input;
    });
    await action.trigger(page);
    await Bun.sleep(200);
    await assertUninjected(page);
    assert.equal((await context.bridge.requests()).length, cursor);
    await editor.evaluate((input) => input.remove());
    const layout = await geometry(page);
    const original = (await screenshot(page)).png;

    await action.trigger(page);
    const faded = await waitForState(page, "faded");
    const response = await context.bridge.waitForRequest(cursor);
    const entry = await cacheEntry(context, response.cacheKey);
    assert.equal(entry.check, undefined);
    const selected = pickedFades(entry);
    assert.equal(faded.faded, selected.length);
    const painted = (await screenshot(page)).png;
    const visible = changedSentences(original, painted, layout);
    assert.ok(visible.length > 0);
    assert.deepEqual(visible.filter((id) => !selected.includes(id)), [], "Prose outside the picks changed");
    await save(context.evidence + "/page-mode-faded", painted);
    await action.trigger(page);
    assert.equal((await waitForState(page, "picks-ready")).faded, 0);
    await poll(() => activeBadge(worker), (badge) => badge === "", 3000);
    const off = (await screenshot(page)).png;
    await save(context.evidence + "/page-mode-off", off);
    const offPixels = regionsChanged(original, off, layout.sentences.flat());
    assert.equal(offPixels, 0);

    await action.trigger(page);
    assert.deepEqual(await waitForState(page, "faded"), faded);
    await page.evaluate(() => history.replaceState(history.state, "", "#filler-cut-test"));
    await Bun.sleep(150);
    assert.deepEqual(await waitForState(page, "faded", 1000), faded);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts.ready);
    const reloadLayout = await geometry(page);
    const reload = (await screenshot(page)).png;
    await Bun.sleep(500);
    const reloadAfter = (await screenshot(page)).png;
    await save(context.evidence + "/page-mode-reloaded", reloadAfter);
    await assertUninjected(page);
    const reloadPixels = regionsChanged(reload, reloadAfter, reloadLayout.sentences.flat());
    assert.equal(reloadPixels, 0);
    assert.deepEqual(await grants(worker), before);
    assert.deepEqual(await registrations(worker), scripts);
    // The page's events are queued and sent like any other. Nothing else is stored.
    const shown = await poll(() => context.bridge.events(), (events) =>
      events.some((event) => event.type === "shown" && event.url.includes("building-effective-agents")), 5000);
    assert.equal(shown.filter((event) => event.type === "shown" && event.url.includes("building-effective-agents")).length, 1);
    const { pendingEvents = [], ...stored } = await worker.evaluate(() => chrome.storage.local.get(null));
    assert.deepEqual(stored, storage);
    assert.deepEqual(pendingEvents, []);
    assert.equal(await worker.evaluate(() =>
      (globalThis as unknown as { permissionRequests: number }).permissionRequests), 0);
    assert.equal((await context.bridge.requests()).slice(cursor).filter(({ path }) => path === "/select").length, 1);
    return `${faded.faded}/${entry.sentences.length} faded (${visible.length} in screenshot), same after a fragment change; editor, off, and reload 0 fades; off and reload 0 changed prose pixels; 1 select, 1 shown event, 0 permission requests, grants, registrations, or storage changes`;
  }));
}
