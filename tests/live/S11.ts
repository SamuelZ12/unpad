import assert from "node:assert/strict";
import type { Page } from "playwright";
import { collapse } from "../../src/core/segment";
import { roots, urls } from "./lib/browser";
import { atMost, waitForState, withBrowser } from "./lib/check";
import { assertCuts, captureDomErrors, referenceCut, withBridge } from "./lib/cut";
import { poll, save, screenshot } from "./lib/pixels";
import { replayNavigation } from "./lib/replay";
import type { CheckContext } from "./run";

export async function followStatus(context: CheckContext, page: Page, wang: Awaited<ReturnType<typeof referenceCut>>) {
  const documentId = () => page.evaluate(() => performance.timeOrigin);
  const before = await documentId();
  const staleMarkers = await wang.root.locator("[data-filler-cut-marker]").elementHandles();
  const selector = context.mode === "logged-in"
    ? "[data-testid=twitterArticleRichTextView] a[href*='/status/']"
    : "main a[data-base-ui-tooltip-trigger][href*='/status/']";
  const links = page.locator(selector).filter({ visible: true });
  const index = context.mode === "replay" ? -1 : await links.evaluateAll((elements, original) =>
    elements.findIndex((element) => {
      const link = element as HTMLAnchorElement;
      const url = new URL(link.href);
      return url.origin === location.origin && /^\/\w+\/status\/\d+$/.test(url.pathname) &&
        url.pathname !== new URL(original).pathname && (!link.target || link.target === "_self") &&
        !!link.textContent?.trim() && !link.closest('[aria-hidden="true"]');
    }), urls.wang);
  assert.ok(context.mode === "replay" || index >= 0, "No visible in-tab link to a second status");
  const link = context.mode === "replay" ? await replayNavigation(page) : links.nth(index);
  const url = new URL((await link.getAttribute("href"))!, urls.wang).href;
  const dialog = page.getByRole("dialog").filter({ visible: true }).first();
  try {
    if (context.mode === "logged-in") await Bun.sleep(3000);
    await link.click({ timeout: 7000 });
    await page.waitForURL(url, { waitUntil: "domcontentloaded", timeout: 6000 });
    assert.ok(!await dialog.isVisible());
  } catch (error) {
    await save(context.evidence + "/after-link", (await screenshot(page)).png);
    const prompt = await dialog.innerText({ timeout: 500 }).catch(() => "");
    throw new Error(`Following ${url} left X at ${page.url()}: ${prompt ? collapse(prompt) : error}`);
  }
  const second = await documentId();
  const path = new URL(url).pathname;
  await page.locator(`article a[href="${path}"], article a[href="${url}"]`).first()
    .waitFor({ state: "attached", timeout: 6000 });
  await page.waitForFunction(() => !!document.documentElement.dataset.fillerCutState);
  assert.equal(await page.locator(roots.wang).count(), 0, "Wang still present on another status");
  if (before === second) {
    for (const marker of staleMarkers) assert.equal(await marker.evaluate((node) => node.isConnected), false);
  }
  if (context.mode === "replay") assert.equal(await page.locator("[data-filler-cut-marker]").count(), 0);
  await save(context.evidence + "/second-status", (await screenshot(page)).png);

  const cursor = (await context.bridge.requests()).length;
  if (context.mode === "logged-in") await Bun.sleep(3000);
  await page.goBack({ waitUntil: "commit" });
  await page.waitForURL(urls.wang, { waitUntil: "commit", timeout: 10_000 });
  await page.locator(roots.wang).first().waitFor({ state: "attached" });
  const appeared = Date.now();
  await wang.root.locator("[data-filler-cut-marker]").first().waitFor({ timeout: 5000 });
  const elapsed = Date.now() - appeared;
  await waitForState(page, "faded", 1000);
  const row = await poll(async () => (await context.bridge.requests()).slice(cursor).find(
    ({ cacheKey }) => cacheKey === wang.row.cacheKey), Boolean, 5000);
  assert.equal(row?.source, "cache");
  await assertCuts(wang.root, wang.entry);
  const back = await documentId();
  if (context.mode !== "logged-out") assert.ok(before === second && back === second, "X navigation replaced the document");
  atMost(elapsed, 1000, "Back to Wang cuts");
  await save(context.evidence + "/back-to-wang", (await screenshot(page)).png);
  return `second status and Back ${before === second && back === second ? "in the same document" : "via document navigation"}, no stale markers, cache recuts Wang in ${elapsed} ms`;
}

export default async function S11(context: CheckContext) {
  return withBridge(context, () => withBrowser(context, async (browser, page) => {
    const assertConsole = captureDomErrors(page);
    try {
      return await followStatus(context, page, await referenceCut(context, browser, page, "wang"));
    } finally {
      await assertConsole(context.evidence + "/console.json");
    }
  }));
}
