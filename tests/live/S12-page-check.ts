import assert from "node:assert/strict";
import type { CheckContext } from "./run";
import { extensionWorker, setAlwaysRun, withActionBrowser } from "./lib/action";
import { waitForState } from "./lib/check";
import { cacheEntry, withBridge } from "./lib/cut";
import { geometry, installGeometry, regionsChanged } from "./lib/geometry";
import { difference, docCrop, poll, save, screenshot } from "./lib/pixels";
import { activeBadge, articleUrl, openSite } from "./lib/sites";

const repo = "https://github.com/firecrawl/firecrawl";
const profile = "https://github.com/SamuelZ12";

export default async function S12PageCheck(context: CheckContext) {
  const { bridge, evidence } = context;
  return withBridge(context, () => withActionBrowser(async (tabs, action) => {
    const page = tabs.pages()[0];
    const worker = await extensionWorker(tabs);
    await installGeometry(tabs);
    await worker.evaluate(() => {
      const probe = Object.assign(globalThis, { selects: [] as string[] });
      chrome.runtime.onMessage.addListener((message, sender) => {
        if (message?.type === "select") probe.selects.push(sender.url ?? "");
      });
    });
    const selects = () => worker.evaluate(() => (globalThis as unknown as { selects: string[] }).selects);
    const index = (await bridge.requests()).length;
    await openSite(page, repo + "?tab=readme-ov-file#readme");
    const readme = page.locator("article.markdown-body p").filter({ hasText: /[A-Za-z]{4}/ }).first();
    await readme.waitFor({ state: "visible" });
    const original = await docCrop(readme);
    await setAlwaysRun(page, true, action);
    const skipped = await bridge.waitForRequest(index);
    assert.equal(skipped.result, "skip");
    assert.ok(skipped.source === "cache" || skipped.piCalls === 2);
    const entry = await cacheEntry(context, skipped.cacheKey);
    assert.deepEqual(entry.selection, { kind: "skip" });
    assert.deepEqual(entry.key, []);
    assert.deepEqual(entry.check, { url: repo });
    assert.equal((await waitForState(page, "idle")).faded, 0);
    await poll(() => activeBadge(worker), (badge) => badge === "", 3000);
    const unchanged = await docCrop(readme);
    await save(evidence + "/readme-skipped", unchanged);
    assert.equal(difference(original, unchanged), 0, "README prose pixels changed");
    assert.ok((await selects()).every((url) => new URL(url).pathname === "/firecrawl/firecrawl"));

    await page.reload({ waitUntil: "domcontentloaded" });
    const repeated = (await poll(() => bridge.requests(), (rows) =>
      rows.slice(index + 1).some((row) => row.cacheKey === skipped.cacheKey), 45_000))
      .slice(index + 1).find((row) => row.cacheKey === skipped.cacheKey)!;
    assert.equal(repeated.result, "skip");
    assert.equal(repeated.source, "cache");
    assert.equal(repeated.piCalls, 0);
    assert.equal((await waitForState(page, "idle")).faded, 0);

    await openSite(page, profile);
    await page.locator("main").first().waitFor({ state: "visible" });
    const profileLayout = await geometry(page);
    const profileBefore = (await screenshot(page)).png;
    await Bun.sleep(1000);
    assert.equal((await waitForState(page, "idle", 3000)).faded, 0);
    assert.equal(await activeBadge(worker), "");
    const profileAfter = (await screenshot(page)).png;
    await save(evidence + "/profile-untouched", profileAfter);
    assert.equal(regionsChanged(profileBefore, profileAfter, profileLayout.sentences.flat()), 0, "Profile prose pixels changed");
    const gitHubSelects = await selects();
    assert.ok(gitHubSelects.every((url) => new URL(url).pathname === "/firecrawl/firecrawl"),
      `An unexpected page sent select: ${gitHubSelects}`);

    await openSite(page, articleUrl);
    const articleLocation = page.url();
    const beforeArticle = (await bridge.requests()).length;
    await setAlwaysRun(page, true, action);
    const article = await waitForState(page, "faded");
    const response = await bridge.waitForRequest(beforeArticle);
    assert.equal(response.result, "keep");
    const checked = await cacheEntry(context, response.cacheKey);
    assert.deepEqual(checked.check, { url: articleLocation });
    return `README ${entry.sentences.length} sentences, SKIP in ${Math.round(skipped.ms)} ms (${skipped.source}, ${skipped.piCalls} Pi calls), ${gitHubSelects.length} selects across add and reload, including a reload cache hit, 0 changed prose pixels and empty badge; profile ${profileLayout.doc.sentences.length} candidate sentences, 0 select messages or changed prose pixels; checked article ${article.faded}/${checked.sentences.length} faded (${response.source})`;
  }));
}
