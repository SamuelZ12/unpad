import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { chromium, type BrowserContext, type Page } from "playwright";
import { launch } from "./browser";
import { extensionId, preapproveHost } from "./extension";
export { extensionId, extensionWorker, preapproveHost } from "./extension";
import { poll } from "./pixels";

export async function reloadExtension(context: BrowserContext) {
  const id = await extensionId(context);
  const settings = await context.newPage();
  try {
    await settings.goto("chrome://extensions/");
    const developer = settings.locator("#devMode");
    const devMode = () => developer.evaluate((toggle) => (toggle as HTMLElement & { checked: boolean }).checked);
    if (!await devMode()) await developer.click();
    await poll(devMode, Boolean, 3000);
    await settings.locator(`extensions-item[id="${id}"] #dev-reload-button`).click({ timeout: 5000 });
    await Bun.sleep(1000);
  } finally {
    await settings.close();
  }
}

export async function addFromPopup(page: Page, action: Awaited<ReturnType<typeof connectAction>>) {
  const url = new URL(page.url());
  const match = `${url.protocol}//${url.hostname}:${url.port || (url.protocol === "https:" ? 443 : 80)}/*`;
  await preapproveHost(page.context(), match);
  await action.withPopup(page, async (popup) => {
    const checkbox = popup.locator("#always");
    await checkbox.waitFor({ state: "visible", timeout: 5000 });
    assert.equal(await checkbox.isChecked(), false, "Preapproval must leave the site unchecked");
    await checkbox.check();
    await popup.getByRole("button", { name: `Remove ${url.host}` }).waitFor({ timeout: 5000 });
  });
  return match;
}

export async function withActionBrowser<T>(run: (
  tabs: BrowserContext, action: Awaited<ReturnType<typeof connectAction>>,
) => Promise<T>, mode: "logged-out" | "replay" = "logged-out", extension?: string) {
  const profile = await mkdtemp("/tmp/filler-chrome-action-");
  try {
    const { context: tabs, close } = await launch(mode, true, undefined, {
      actionProfile: profile, extension, viewport: { width: 1280, height: 3900 },
    });
    try {
      const action = await connectAction(tabs, profile);
      try {
        return await run(tabs, action);
      } finally {
        await action.close();
      }
    } finally {
      await close();
    }
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
}

export async function connectAction(context: BrowserContext, profile: string) {
  const id = await extensionId(context);
  const [port] = (await readFile(profile + "/DevToolsActivePort", "utf8")).split("\n");
  const endpoint = "http://127.0.0.1:" + port;
  const browser = await chromium.connectOverCDP(endpoint, { noDefaults: true });
  const cdp = await browser.newBrowserCDPSession();
  async function withPopup<T>(page: Page, run: (popup: Page) => Promise<T>) {
    await page.bringToFront();
    const { targetInfos } = await cdp.send("Target.getTargets", { filter: [{ type: "tab" }] });
    const target = targetInfos.find(({ url, embedderData }) => url === page.url() && embedderData?.tabActive);
    assert.ok(target, `No active tab target for ${page.url()}`);
    await cdp.send("Extensions.triggerAction", { id, targetId: target.targetId });
    const popupUrl = `chrome-extension://${id}/popup.html`;
    await poll(async () => (await cdp.send("Target.getTargets")).targetInfos.some(({ url }) => url === popupUrl), Boolean, 5000)
      .catch((error) => { throw new Error(`Chrome did not open ${popupUrl} for ${page.url()}`, { cause: error }); });
    // The first Playwright session sees the target before its popup page has a URL.
    const popupBrowser = await chromium.connectOverCDP(endpoint, { noDefaults: true });
    try {
      const popup = await poll(async () => popupBrowser.contexts()[0].pages().find((page) => page.url() === popupUrl),
        (page) => !!page, 5000)
        .catch((error) => { throw new Error(`Playwright could not attach to ${popupUrl}`, { cause: error }); });
      assert.ok(popup);
      try {
        return await run(popup);
      } catch (error) {
        const detail = await popup.locator("body").innerText({ timeout: 1000 }).catch(() => "(popup closed)");
        throw new Error(`${page.url()} popup "${detail}": ${error}`);
      } finally {
        if (!popup.isClosed()) await popup.close();
      }
    } finally {
      await popupBrowser.close();
    }
  }

  return {
    withPopup,
    press: (page: Page) => withPopup(page, async (popup) => {
      await popup.getByRole("switch").click({ timeout: 5000 });
      await popup.waitForFunction(() => document.querySelector<HTMLButtonElement>("#lens")?.disabled === false);
      assert.equal(await popup.locator("#error").isHidden(), true, await popup.locator("#error").textContent() ?? "");
    }),
    close: () => browser.close(),
  };
}
