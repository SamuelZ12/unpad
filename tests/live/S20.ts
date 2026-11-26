import assert from "node:assert/strict";
import type { Page } from "playwright";
import type { CheckContext } from "./run";
import { addFromPopup, extensionWorker, reloadExtension, withActionBrowser } from "./lib/action";
import { watchSelections } from "./lib/extension";
import { registrations } from "./lib/sites";
import { launch, urls, xHomeUrl } from "./lib/browser";
import { toggle, waitForState } from "./lib/check";
import { withBridge } from "./lib/cut";
import { poll } from "./lib/pixels";

const unenabled = "https://example.com/";
const toast = (page: Page) => page.locator("filler-cut-toast").getByRole("status");

async function assertPlainToast(page: Page) {
  await toast(page).getByText("Nothing to cut here", { exact: true }).waitFor({ timeout: 3000 });
  assert.equal(await toast(page).innerText(), "Nothing to cut here");
}

async function captures(popup: Page, file: string, expected: string | RegExp, restricted = false) {
  await popup.waitForFunction(({ expected, regex }) => {
    const text = document.querySelector("#status")?.textContent ?? "";
    return regex ? new RegExp(expected).test(text) : text === expected;
  }, { expected: typeof expected === "string" ? expected : expected.source, regex: expected instanceof RegExp });
  assert.equal(await popup.getByRole("switch").isVisible(), !restricted);
  assert.equal(await popup.getByRole("checkbox").isVisible(), !restricted);
  assert.equal(await popup.getByRole("link", { name: "Change shortcut" }).count(), 1);
  assert.deepEqual(await popup.locator("#sites li").evaluateAll((rows) =>
    rows.map((row) => [...row.children].map(({ textContent }) => textContent))), [["x.com", "built in"]]);
  // Chrome's extension stylesheet shrinks body text to 75% unless the popup sets it.
  assert.equal(await popup.locator("#status").evaluate((status) => getComputedStyle(status).fontSize), "13px");
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
      await assertPlainToast(page);
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
      await assertPlainToast(page);
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
        await captures(popup, context.evidence + "/x-home", "Nothing to cut here");
        const builtIn = popup.getByRole("checkbox", { name: "Always run on x.com built in" });
        assert.equal(await builtIn.isChecked(), true);
        assert.equal(await builtIn.isDisabled(), true);
        await popup.getByRole("switch").click();
        await assertPlainToast(page);
      });
      assert.deepEqual(await worker.evaluate(() => chrome.storage.local.get("lensOn")), {});

      await page.route(unenabled, (route) => route.fulfill({ contentType: "text/html", body: "<title>Example</title><p>Too short.</p>" }));
      await page.goto(unenabled);
      await action.withPopup(page, async (popup) => {
        await captures(popup, context.evidence + "/unenabled", /Off on this site\. Use the switch or .+ to cut this page once\./);
        const toggle = popup.getByRole("switch");
        await toggle.click();
        await assertPlainToast(page);
        await popup.getByText("Nothing to cut here", { exact: true }).waitFor({ timeout: 3000 });
        assert.equal(await toggle.getAttribute("aria-checked"), "false");
        const snapshot = await popup.evaluate(async () => {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          return chrome.tabs.sendMessage(tab.id!, { type: "page-status" });
        });
        assert.equal(snapshot.mode, undefined);
      });
      assert.equal(await selections(), 0);
      const match = await addFromPopup(page, action);
      await poll(() => registrations(worker), (scripts) => scripts.join() === match, 3000);
      await action.withPopup(page, async (popup) => {
        await popup.getByRole("checkbox").uncheck();
        await popup.getByRole("button", { name: /^Remove / }).waitFor({ state: "detached", timeout: 5000 });
      });
      await poll(() => registrations(worker), (scripts) => !scripts.length, 3000);

      await page.goto("chrome://version/");
      await action.withPopup(page, (popup) =>
        captures(popup, context.evidence + "/chrome", "Unpad can’t run on this page.", true));

      await page.goto(urls.wang);
      const { faded } = await waitForState(page, "faded");
      const marked = Number(await page.locator("html").getAttribute("data-filler-cut-marked"));
      const expected = [
        faded ? `Removed ${faded} sentence${faded === 1 ? "" : "s"}` : "",
        marked ? `${marked} key point${marked === 1 ? "" : "s"}` : "",
      ].filter(Boolean).join(" · ");
      await action.withPopup(page, (popup) => captures(popup, context.evidence + "/cut", expected));

      // A reload orphans the open tab's script. The switch starts a new one instead of flipping the shared lens.
      await action.press(page);
      await waitForState(page, "picks-ready");
      await reloadExtension(tabs);
      await action.withPopup(page, async (popup) => {
        await popup.evaluate(() => chrome.storage.local.set({ lensOn: true }));
        await popup.getByText("Use the switch to start Unpad here.").waitFor({ timeout: 5000 });
        const lens = popup.getByRole("switch");
        assert.equal(await lens.getAttribute("aria-checked"), "false");
        await lens.click();
        await popup.waitForFunction(() => document.querySelector<HTMLButtonElement>("#lens")?.disabled === false);
        await popup.locator("#lens[aria-checked=true]").waitFor({ timeout: 5000 });
        assert.deepEqual(await popup.evaluate(() => chrome.storage.local.get("lensOn")), { lensOn: true });
      });
      assert.equal((await waitForState(page, "faded", 5000)).faded, faded);
    }, "replay");
    return "presses on empty X home and a short status show the plain toast with lens unchanged and zero selects; one-shot blank page ends; popup checkbox adds and removes a routed site; four native popup states captured in light and dark; after an extension reload the switch restarts the open tab with the lens on";
  });
}
