import assert from "node:assert/strict";
import type { Page, Worker } from "playwright";
import type { CheckContext } from "./run";
import { extensionWorker, withActionBrowser } from "./lib/action";
import { launch, urls, xHomeUrl } from "./lib/browser";
import { toggle, waitForState } from "./lib/check";
import { withBridge } from "./lib/cut";

const unenabled = "https://example.com/";
const toast = (page: Page) => page.locator("filler-cut-toast").getByRole("status");

async function watchSelections(worker: Worker) {
  await worker.evaluate(() => {
    const selectRequests = Object.assign(globalThis, { selections: 0 });
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === "select") selectRequests.selections++;
    });
  });
  return () => worker.evaluate(() => (globalThis as unknown as { selections: number }).selections);
}

async function captures(popup: Page, file: string, expected: string | RegExp, restricted = false) {
  await popup.waitForFunction(({ expected, regex }) => {
    const text = document.querySelector("#status")?.textContent ?? "";
    return regex ? new RegExp(expected).test(text) : text === expected;
  }, { expected: typeof expected === "string" ? expected : expected.source, regex: expected instanceof RegExp });
  assert.equal(await popup.getByRole("switch").isVisible(), !restricted);
  assert.equal(await popup.getByRole("checkbox").isVisible(), !restricted);
  assert.equal(await popup.getByRole("link", { name: "Change shortcut" }).count(), 1);
  assert.deepEqual(await popup.locator("#sites li").allTextContents(), ["x.com", "claude.com"]);
  for (const colorScheme of ["light", "dark"] as const) {
    await popup.emulateMedia({ colorScheme });
    await popup.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    const clip = await popup.locator("body").boundingBox();
    assert.ok(clip);
    assert.equal(clip.width, 312);
    await popup.screenshot({ path: `${file}-${colorScheme}.png`, clip });
  }
}

export default async function S20(context: CheckContext) {
  return withBridge(context, async () => {
    const fallback = await launch("replay", true, undefined, { extension: context.fallbackExtension });
    try {
      const page = fallback.context.pages()[0];
      await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
      const worker = await extensionWorker(fallback.context);
      const selections = await watchSelections(worker);
      await worker.evaluate(() => chrome.storage.local.set({ lensOn: true }));
      await page.goto(xHomeUrl);
      assert.equal(page.url(), xHomeUrl);
      await page.locator("html[data-filler-cut-debug]").waitFor({ state: "attached" });
      assert.equal(await toast(page).count(), 0);
      await toggle(page);
      await toast(page).getByText("Open a post or article to cut it.").waitFor({ timeout: 3000 });
      await page.screenshot({ path: context.evidence + "/x-home-toast.png" });
      assert.deepEqual(await worker.evaluate(() => chrome.storage.local.get("lensOn")), { lensOn: true });
      await page.route("https://x.com/example/status/1", (route) => route.fulfill({
        contentType: "text/html",
        headers: { "content-security-policy": "style-src 'none'" },
        body: '<main><article><a href="/example/status/1"><time>Now</time></a><div dir="auto" lang="en">Two short sentences. Like this one.</div></article></main>',
      }));
      await page.goto("https://x.com/example/status/1");
      await page.locator("html[data-filler-cut-debug]").waitFor({ state: "attached" });
      assert.equal(await toast(page).count(), 0);
      await toggle(page);
      await toast(page).getByText("Nothing to cut here", { exact: true }).waitFor({ timeout: 3000 });
      assert.equal(await toast(page).innerText(), "Nothing to cut here");
      assert.equal(await toast(page).evaluate((box) => getComputedStyle(box).position), "fixed");
      assert.deepEqual(await worker.evaluate(() => chrome.storage.local.get("lensOn")), { lensOn: true });
      assert.equal(await selections(), 0);
    } finally {
      await fallback.close();
    }

    await withActionBrowser(async (tabs, action) => {
      const page = tabs.pages()[0];
      await page.setViewportSize({ width: 1280, height: 850 });
      const worker = await extensionWorker(tabs);
      const selections = await watchSelections(worker);
      await page.goto(xHomeUrl);
      await waitForState(page, "idle");
      await action.withPopup(page, async (popup) => {
        await captures(popup, context.evidence + "/x-home", "Nothing to cut here. Open a post or article to cut it.");
        const builtIn = popup.getByRole("checkbox", { name: "Always run on x.com built in" });
        assert.equal(await builtIn.isChecked(), true);
        assert.equal(await builtIn.isDisabled(), true);
        await popup.getByRole("switch").click();
        await toast(page).getByText("Open a post or article to cut it.").waitFor({ timeout: 3000 });
      });
      assert.deepEqual(await worker.evaluate(() => chrome.storage.local.get("lensOn")), {});

      await page.route(unenabled, (route) => route.fulfill({ contentType: "text/html", body: "<title>Example</title><p>Too short.</p>" }));
      await page.goto(unenabled);
      await action.withPopup(page, async (popup) => {
        await captures(popup, context.evidence + "/unenabled", /Off on this site\. Use the switch or .+ to cut this page once\./);
        const toggle = popup.getByRole("switch");
        await toggle.click();
        await toast(page).getByText("Nothing to cut here", { exact: true }).waitFor({ timeout: 3000 });
        await popup.getByText("Nothing to cut here", { exact: true }).waitFor({ timeout: 3000 });
        assert.equal(await toggle.getAttribute("aria-checked"), "false");
        const snapshot = await popup.evaluate(async () => {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          return chrome.tabs.sendMessage(tab.id!, { type: "page-status" });
        });
        assert.equal(snapshot.mode, undefined);
      });
      assert.equal(await selections(), 0);

      await page.goto("chrome://version/");
      await action.withPopup(page, (popup) =>
        captures(popup, context.evidence + "/chrome", "Filler Cut can't run on this page.", true));

      await page.goto(urls.wang);
      const { faded } = await waitForState(page, "faded");
      const marked = Number(await page.locator("html").getAttribute("data-filler-cut-marked"));
      const expected = [
        faded ? `Removed ${faded} sentence${faded === 1 ? "" : "s"}` : "",
        marked ? `${marked} key point${marked === 1 ? "" : "s"}` : "",
      ].filter(Boolean).join(" · ");
      await action.withPopup(page, (popup) => captures(popup, context.evidence + "/cut", expected));
    }, "replay");
    return "X home page-key fallback and popup switch show the post hint, short post shows the plain toast, lens unchanged and zero selects; one-shot blank page ends; four native popup states captured in light and dark";
  });
}
