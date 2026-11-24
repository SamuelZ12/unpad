import assert from "node:assert/strict";
import type { CheckContext } from "./run";
import { roots, urls } from "./lib/browser";
import { atMost, toggle, waitForState, withBrowser } from "./lib/check";
import { cacheEntry, pickedFades, withBridge } from "./lib/fade";
import { changedSentences, geometry, installGeometry } from "./lib/geometry";
import { save, screenshot } from "./lib/pixels";
import { replayNavigation } from "./lib/replay";

export default async function S11(context: CheckContext) {
  return withBridge(context, () => withBrowser(context, async (browser, page) => {
    await installGeometry(browser.context);
    await browser.context.addInitScript((root) => {
      const win = window as unknown as { verifyDocument: string; verifyWangAt: number };
      win.verifyDocument = crypto.randomUUID();
      let prior: Element | null = null;
      new MutationObserver(() => {
        const current = document.querySelector(root);
        if (current && current !== prior) win.verifyWangAt = Date.now();
        prior = current;
      }).observe(document, { subtree: true, childList: true });
    }, roots.wang);
    const docToken = () => page.evaluate(() => (window as unknown as { verifyDocument: string }).verifyDocument);
    await page.setViewportSize({ width: 1280, height: 3700 });
    await browser.open(page, "wang");
    await waitForState(page, "faded");
    const originalKey = (await geometry(page)).doc.key;
    const before = await docToken();
    const statusLinks = context.mode === "logged-in"
      ? "[data-testid=twitterArticleRichTextView] a[href*='/status/']"
      : "main a[href*='/status/']";
    const link = context.mode === "replay" ? await replayNavigation(page) :
      page.locator(statusLinks).filter({ visible: true }).and(
        page.locator("a:not([aria-hidden=true]):not([href*='2124636606959345776']):not([href$='/analytics']):not([href$='/quotes']):not([href*='/photo/'])"),
      ).first();
    const href = await link.getAttribute("href", { timeout: 5000 });
    assert.ok(href && /^\/\w+\/status\/\d+(?:$|\?)/.test(new URL(href, urls.wang).pathname), `No second status link (${href})`);
    const secondUrl = new URL(href, urls.wang).href;
    if (context.mode === "logged-in") await Bun.sleep(3000);
    const outboundIndex = (await context.bridge.requests()).length;
    const accountPages = browser.context.pages().length;
    await link.click({ timeout: 7000 });
    try {
      await page.waitForURL(secondUrl, { waitUntil: "domcontentloaded", timeout: 6000 });
    } catch {
      await save(context.evidence + "/after-link", (await screenshot(page)).png);
      const opened = browser.context.pages().slice(accountPages).map((tab) => tab.url());
      const dialog = await page.getByRole("dialog").first().textContent({ timeout: 500 }).catch(() => null);
      throw new Error(`Clicked ${secondUrl}, current tab stayed at ${page.url()}, new tabs ${JSON.stringify(opened)}${dialog ? `, dialog ${dialog.trim().slice(0, 100)}` : ""}`);
    }
    const inPlace = before === await docToken();
    const second = await page.evaluate(() => window.fillerCutGeometry());
    assert.ok(!second || second.doc.key !== originalKey, "Still rendering the Wang document on the second status");
    if (second) {
      const row = await context.bridge.waitForRequest(outboundIndex);
      const entry = await cacheEntry(context, row.cacheKey);
      assert.deepEqual(entry.sentences, second.doc.sentences);
      const count = pickedFades(entry).length;
      assert.equal((await waitForState(page, count ? "faded" : "idle")).faded, count);
    } else {
      assert.equal((await waitForState(page, "idle")).faded, 0);
    }
    await save(context.evidence + "/second-status", (await screenshot(page)).png);

    const index = (await context.bridge.requests()).length;
    if (context.mode === "logged-in") await Bun.sleep(3000);
    await page.goBack({ waitUntil: "commit" });
    await page.waitForURL(urls.wang, { waitUntil: "commit", timeout: 10_000 });
    await waitForState(page, "faded");
    const backInPlace = before === await docToken();
    const row = await context.bridge.waitForRequest(index);
    assert.equal(row.source, "cache");
    assert.equal(row.piCalls, 0);
    const backAt = await page.evaluate(() => (window as unknown as { verifyWangAt: number }).verifyWangAt);
    assert.ok(backAt > 0);
    const layout = await geometry(page);
    const faded = await screenshot(page);
    await toggle(page);
    await waitForState(page, "picks-ready");
    await Bun.sleep(180);
    const original = await screenshot(page);
    await toggle(page);
    await waitForState(page, "faded");
    const changed = changedSentences(original.png, faded.png, layout);
    assert.ok(changed.length > 0, "The cached Wang screenshot had no faded pixels");
    const elapsed = faded.at - backAt;
    await save(context.evidence + "/back-to-wang", faded.png);
    const navigation = `outbound ${inPlace ? "same document" : "new document"}, Back ${backInPlace ? "same document" : "new document"}, Wang cached fade in ${elapsed} ms`;
    await Bun.write(context.evidence + "/navigation.json", JSON.stringify({
      secondUrl, inPlace, backInPlace, fadedPixelsAt: faded.at, textAt: backAt, elapsed,
    }, null, 2));
    atMost(elapsed, 1000, navigation);
    assert.ok(inPlace && backInPlace, navigation);
    return navigation;
  }));
}
