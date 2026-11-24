// On two live sites, compare article pixels and bridge logs before and after
// Chrome's toolbar action. Chrome gets one exact origin per request. The check
// pre-approves each origin in the isolated profile, and separately dismisses a
// pending prompt by closing its window. Verify immediate fades, reload, another
// tab and article, restart, and one lens change per action or fallback key.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import type { Page, Worker } from "playwright";
import type { CheckContext } from "./run";
import { clearActionShortcut, connectAction, extensionWorker, preapproveHost } from "./lib/action";
import { launch, state } from "./lib/browser";
import { toggle, waitForState } from "./lib/check";
import { cacheEntry, pickedFades, withBridge } from "./lib/fade";
import { changedSentences, geometry, installGeometry, regionsChanged } from "./lib/geometry";
import { poll, save, screenshot } from "./lib/pixels";

const sites = [
  {
    name: "Anthropic",
    first: "https://www.anthropic.com/engineering/building-effective-agents",
    next: "https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents",
  },
  {
    name: "Simon",
    first: "https://simonwillison.net/2026/Jan/12/claude-cowork/",
    next: "https://simonwillison.net/2026/Jun/11/fable-is-relentlessly-proactive/",
  },
];

interface Prompt {
  origins: string[];
  granted?: boolean;
}

const grantFor = (url: string) => `${new URL(url).origin}:443/*`;
const excluded = "nav, aside, footer, header, form, figure, pre, table";

async function observeActions(worker: Worker) {
  await worker.evaluate(() => {
    const probe = Object.assign(globalThis, { prompts: [] as Prompt[], lensChanges: [] as boolean[] });
    const request = chrome.permissions.request.bind(chrome.permissions);
    chrome.permissions.request = ((permission: chrome.permissions.Permissions) => {
      const prompt: Prompt = { origins: permission.origins ?? [] };
      probe.prompts.push(prompt);
      return request(permission).then((granted) => {
        prompt.granted = granted;
        return granted;
      });
    }) as typeof chrome.permissions.request;
    chrome.storage.onChanged.addListener(({ lensOn }, area) => {
      if (area === "local" && lensOn) probe.lensChanges.push(lensOn.newValue === true);
    });
  });
  return {
    prompts: () => worker.evaluate(() => (globalThis as unknown as { prompts: Prompt[] }).prompts),
    changes: () => worker.evaluate(() => (globalThis as unknown as { lensChanges: boolean[] }).lensChanges),
  };
}

async function open(page: Page, url: string) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 3900 });
  const response = await page.goto(url, { waitUntil: "load" });
  assert.ok(response?.ok(), `HTTP ${response?.status()} from ${page.url()}`);
  await page.evaluate(() => document.fonts.ready);
}

async function assertUntouched(page: Page) {
  assert.deepEqual(await state(page), { view: undefined, faded: NaN });
  assert.equal(await page.evaluate(() => CSS.highlights.has("filler-cut")), false);
}

export default async function S12EnableSite(context: CheckContext) {
  const { bridge, evidence } = context;
  const profile = await mkdtemp("/tmp/filler-chrome-enable-");
  try {
    return await withBridge(context, async () => {
      const results: string[] = [];
      const browser = await launch("logged-out", true, undefined, { actionProfile: profile });
      const { context: tabs } = browser;
      try {
        const action = await connectAction(tabs, profile);
        try {
          await installGeometry(tabs);
          const worker = await extensionWorker(tabs);
          const command = await worker.evaluate(async () =>
            (await chrome.commands.getAll()).find(({ name }) => name === "_execute_action")?.shortcut);
          assert.ok(command, "Chrome did not register the shortcut");
          // Start with the lens off to prove that enabling a site fades it on the first click.
          await worker.evaluate(() => chrome.storage.local.set({ lensOn: false }));
          const events = await observeActions(worker);
          const cursor = (await bridge.requests()).length;
          const logCursor = (await bridge.events()).length;
          const denied = tabs.pages()[0];
          await open(denied, sites[0].first);
          const layout = await geometry(denied);
          const original = (await screenshot(denied)).png;
          await action.trigger(denied);
          await poll(events.prompts, (prompts) => prompts.length === 1, 3000);
          await Bun.sleep(300);
          const during = (await screenshot(denied)).png;
          await save(evidence + "/denied", during);
          assert.equal(regionsChanged(original, during, layout.sentences.flat()), 0);
          await assertUntouched(denied);
          assert.deepEqual(await events.prompts(), [{ origins: [grantFor(denied.url())] }]);
          const deniedGrant = grantFor(denied.url());
          await denied.close();
          await poll(events.prompts, (prompts) => prompts[0]?.granted === false, 5000);
          const page = await tabs.newPage();
          await open(page, sites[0].first);
          await assertUntouched(page);
          assert.equal((await bridge.requests()).length, cursor);
          assert.equal((await bridge.events()).length, logCursor);
          assert.equal(await worker.evaluate((match) => chrome.permissions.contains({ origins: [match] }), deniedGrant), false);
          assert.deepEqual(await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts()), []);
          assert.deepEqual(await events.changes(), []);
          results.push("dismissed prompt: 0 changed prose pixels, requests, grants, or lens changes");

          for (const { name, first, next } of sites) {
            await open(page, first);
            const grant = grantFor(page.url());
            const layout = await geometry(page, excluded);
            const before = (await screenshot(page)).png;
            const requestIndex = (await bridge.requests()).length;
            const eventIndex = (await bridge.events()).length;
            const promptIndex = (await events.prompts()).length;
            await Bun.sleep(300);
            assert.equal(regionsChanged(before, (await screenshot(page)).png, layout.sentences.flat()), 0, name);
            // Chrome Settings grants this origin. The action still calls the real permissions API.
            await preapproveHost(tabs, grant);
            await page.bringToFront();
            await assertUntouched(page);
            assert.equal((await bridge.requests()).length, requestIndex, name);
            assert.equal((await bridge.events()).length, eventIndex, name);
            const ready = (await screenshot(page)).png;
            await save(evidence + "/" + name + "-original", ready);

            const view = () => page.evaluate(() => performance.timeOrigin);
            const documentBefore = await view();
            await action.trigger(page);
            const faded = await waitForState(page, "faded");
            assert.equal(await view(), documentBefore, name);
            assert.deepEqual((await events.prompts()).slice(promptIndex), [{ origins: [grant], granted: true }]);
            const response = await bridge.waitForRequest(requestIndex);
            const entry = await cacheEntry(context, response.cacheKey);
            assert.equal(entry.sentences.length, layout.doc.sentences.length);
            assert.equal(layout.excludedHits, 0);
            const selection = pickedFades(entry);
            assert.equal(faded.faded, selection.length);
            const settled = (await screenshot(page)).png;
            const visible = changedSentences(ready, settled, layout);
            assert.ok(visible.length > 0, `${name}: no faded prose pixels`);
            assert.deepEqual(visible.filter((id) => !selection.includes(id)), [], name);
            await save(evidence + "/" + name + "-enabled", settled);
            assert.equal((await bridge.requests()).length - requestIndex, 1, name);

            await page.reload({ waitUntil: "load" });
            assert.deepEqual(await waitForState(page, "faded"), faded);
            assert.equal((await bridge.waitForRequest(requestIndex + 1)).source, "cache");
            const second = await tabs.newPage();
            await open(second, next);
            assert.equal(grantFor(second.url()), grant);
            const secondFades = await waitForState(second, "faded");
            const otherEntry = await cacheEntry(context, (await bridge.waitForRequest(requestIndex + 2)).cacheKey);
            assert.notEqual(otherEntry.cacheKey, entry.cacheKey);
            assert.equal(secondFades.faded, pickedFades(otherEntry).length);
            assert.equal(await second.evaluate(() => CSS.highlights.get("filler-cut")?.size), secondFades.faded);
            assert.equal((await bridge.requests()).length - requestIndex, 3, name);
            await save(evidence + "/" + name + "-second", (await screenshot(second)).png);
            results.push(`${name} (${layout.rootTag}): 0 changed pixels and requests before action, ${faded.faded}/${entry.sentences.length} faded (${visible.length} in screenshot), 1 request, reload ${faded.faded} faded, second tab ${secondFades.faded}/${otherEntry.sentences.length} faded`);
            await second.close();
          }

          const other = await tabs.newPage();
          await open(other, sites[0].first);
          await waitForState(other, "faded");
          const before = (await events.changes()).length;
          const requests = (await bridge.requests()).length;
          await toggle(page); // CDP sends a DOM key even while Chrome owns the shortcut.
          await Bun.sleep(200);
          assert.deepEqual((await events.changes()).slice(before), []);
          await action.trigger(page);
          await waitForState(page, "picks-ready");
          await waitForState(other, "picks-ready");
          assert.deepEqual((await events.changes()).slice(before), [false]);
          await clearActionShortcut(tabs);
          await toggle(page);
          await waitForState(page, "faded");
          await waitForState(other, "faded");
          assert.deepEqual((await events.changes()).slice(before), [false, true]);
          assert.equal((await bridge.requests()).length, requests);
          results.push("enabled tabs: assigned DOM key 0 changes, browser action 1, fallback key 1, 0 extra requests");
        } finally {
          await action.close();
        }
      } finally {
        await browser.close();
      }

      const restarted = await launch("logged-out", true, undefined, { actionProfile: profile });
      try {
        const worker = await extensionWorker(restarted.context);
        const page = restarted.context.pages()[0];
        const matches = sites.map(({ first }) => grantFor(first)).sort();
        const registered = () => worker.evaluate(async () =>
          (await chrome.scripting.getRegisteredContentScripts()).flatMap((script) => script.matches ?? []).sort());
        await poll(registered, (origins) => origins.length >= matches.length, 5000);
        assert.deepEqual(await registered(), matches);
        const afterRestart = [];
        for (const { first } of sites) {
          const index = (await bridge.requests()).length;
          await open(page, first);
          afterRestart.push((await waitForState(page, "faded")).faded);
          assert.equal((await bridge.waitForRequest(index)).source, "cache");
        }
        results.push(`browser restart: ${afterRestart.join("/")} faded on load from cache`);
      } finally {
        await restarted.close();
      }
      return results.join("; ");
    });
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
}
