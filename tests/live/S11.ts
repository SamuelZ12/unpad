// Follow a status link from faded Wang, then use Back. The second status has
// its own picks or stays untouched, with 0 sentences faded from Wang's picks.
// Wang fades from the cache within 1 s of its text appearing again. Replay
// and logged-in navigation stay in one document. Logged-out runs report the navigation.
import assert from "node:assert/strict";
import { collapse } from "../../src/core/segment";
import { docKey } from "../../src/shared/keys";
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
        if (current?.textContent?.trim()) {
          if (current !== prior) win.verifyWangAt = Date.now();
          prior = current;
        } else {
          prior = null;
        }
      }).observe(document, { subtree: true, childList: true });
    }, roots.wang);
    const docToken = () => page.evaluate(() => (window as unknown as { verifyDocument: string }).verifyDocument);
    await page.setViewportSize({ width: 1280, height: 3700 });
    const firstIndex = (await context.bridge.requests()).length;
    await browser.open(page, "wang");
    const before = await docToken();
    const statusLinks = context.mode === "logged-in"
      ? "[data-testid=twitterArticleRichTextView] a[href*='/status/']"
      : "main a[data-base-ui-tooltip-trigger][href*='/status/']";
    const candidates = page.locator(statusLinks).filter({ visible: true });
    // X also renders hidden card overlays and action links that open a sign-in dialog.
    const candidateIndex = context.mode === "replay" ? -1 : await candidates.evaluateAll((links, original) =>
      links.findIndex((element) => {
        const link = element as HTMLAnchorElement;
        const url = new URL(link.href);
        return url.origin === location.origin && /^\/\w+\/status\/\d+$/.test(url.pathname) &&
          url.pathname !== new URL(original).pathname && (!link.target || link.target === "_self") &&
          link.textContent!.trim() !== "" && !link.closest('[aria-hidden="true"]');
      }), urls.wang);
    assert.ok(context.mode === "replay" || candidateIndex >= 0, "No visible in-tab status link on Wang");
    const link = context.mode === "replay" ? await replayNavigation(page) : candidates.nth(candidateIndex);
    const href = await link.getAttribute("href", { timeout: 5000 });
    assert.ok(href && /^\/\w+\/status\/\d+(?:$|\?)/.test(new URL(href, urls.wang).pathname), `No second status link (${href})`);
    const secondUrl = new URL(href, urls.wang).href;
    await page.locator("html[data-filler-cut-state=faded]").waitFor({ state: "attached", timeout: 45_000 });
    if (context.mode === "logged-in") await Bun.sleep(3000);
    const accountPages = browser.context.pages().length;
    const dialog = page.getByRole("dialog").filter({ visible: true }).first();
    try {
      await link.click({ timeout: 7000 });
      const navigated = await Promise.race([
        page.waitForURL(secondUrl, { waitUntil: "domcontentloaded", timeout: 6000 }).then(() => true),
        dialog.waitFor({ state: "visible", timeout: 6500 }).then(() => false),
      ]);
      if (!navigated || await dialog.isVisible()) throw new Error("X opened a dialog");
    } catch (error) {
      await save(context.evidence + "/after-link", (await screenshot(page)).png);
      const opened = browser.context.pages().slice(accountPages).map((tab) => tab.url());
      const dialogText = await dialog.innerText({ timeout: 500 }).catch(() => "");
      throw new Error(`Clicked ${secondUrl}, current tab at ${page.url()}, new tabs ${JSON.stringify(opened)}${dialogText ? `, dialog ${JSON.stringify(collapse(dialogText))}` : `, ${error}`}`);
    }
    const secondToken = await docToken();
    const inPlace = before === secondToken;
    const path = new URL(secondUrl).pathname;
    await page.locator(`article a[href="${path}"], article a[href="${secondUrl}"]`).first()
      .waitFor({ state: "attached", timeout: 6000 });
    const wang = await cacheEntry(context, (await context.bridge.waitForRequest(firstIndex)).cacheKey);
    const originalKey = await docKey(wang.title, wang.sentences);
    const wangFades = new Set(pickedFades(wang).map((id) => wang.sentences[id - 1]));
    const second = await page.evaluate(() => window.fillerCutGeometry());
    assert.ok(!second || second.doc.key !== originalKey, "Still rendering the Wang document on the second status");
    let secondFades = 0;
    if (second) {
      const row = await context.bridge.waitForRequest(firstIndex + 1);
      const entry = await cacheEntry(context, row.cacheKey);
      assert.deepEqual(entry.sentences, second.doc.sentences);
      secondFades = pickedFades(entry).length;
      assert.equal((await waitForState(page, secondFades ? "faded" : "idle")).faded, secondFades);
    } else {
      assert.equal((await waitForState(page, "idle")).faded, 0);
    }
    const highlighted = await page.evaluate(() => Array.from(CSS.highlights.get("filler-cut") ?? [], (range) => range.toString()));
    assert.equal(highlighted.length, secondFades, "Unexpected highlights on the second status");
    assert.ok(highlighted.every((text) => !wangFades.has(collapse(text))), "Second status has a highlighted sentence from Wang");
    await save(context.evidence + "/second-status", (await screenshot(page)).png);

    const index = (await context.bridge.requests()).length;
    if (context.mode === "logged-in") await Bun.sleep(3000);
    await page.goBack({ waitUntil: "commit" });
    await page.waitForURL(urls.wang, { waitUntil: "commit", timeout: 10_000 });
    await waitForState(page, "faded");
    const backInPlace = secondToken === await docToken();
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
    const navigation = `outbound ${inPlace ? "same document" : "new document"}, Back ${backInPlace ? "same document" : "new document"}, second status ${secondFades} fades and 0 from Wang, Wang cached fade in ${elapsed} ms`;
    await Bun.write(context.evidence + "/navigation.json", JSON.stringify({
      secondUrl, inPlace, backInPlace, secondFades, fadedPixelsAt: faded.at, textAt: backAt, elapsed,
    }, null, 2));
    atMost(elapsed, 1000, navigation);
    if (context.mode !== "logged-out") assert.ok(inPlace && backInPlace, navigation);
    return navigation;
  }));
}
