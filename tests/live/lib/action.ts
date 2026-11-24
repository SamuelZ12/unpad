import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { chromium, type BrowserContext, type Page } from "playwright";
import { launch } from "./browser";
import { poll } from "./pixels";

export async function extensionWorker(context: BrowserContext) {
  return context.serviceWorkers()[0] ?? context.waitForEvent("serviceworker", { timeout: 5000 });
}

export async function extensionId(context: BrowserContext) {
  return new URL((await extensionWorker(context)).url()).hostname;
}

async function extensionSettings(context: BrowserContext, change: (page: Page, id: string) => Promise<void>) {
  const id = await extensionId(context);
  const settings = await context.newPage();
  try {
    await settings.goto("chrome://extensions/shortcuts");
    await change(settings, id);
  } finally {
    await settings.close();
  }
}

async function preapproveHost(context: BrowserContext, match: string) {
  await extensionSettings(context, (settings, id) => settings.evaluate(({ id, match }) => {
    const { developerPrivate } = chrome as unknown as {
      developerPrivate: { addHostPermission(id: string, match: string, done: () => void): void };
    };
    return new Promise<void>((resolve, reject) => {
      developerPrivate.addHostPermission(id, match, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });
  }, { id, match }));
}

export async function setAlwaysRun(page: Page, checked: boolean, action: Awaited<ReturnType<typeof connectAction>>) {
  const context = page.context();
  const url = new URL(page.url());
  const match = `${url.protocol}//${url.hostname}:${url.port || (url.protocol === "https:" ? 443 : 80)}/*`;
  if (checked) await preapproveHost(context, match);
  const worker = await extensionWorker(context);
  await worker.evaluate((next) => {
    const { testSiteMenu } = globalThis as unknown as { testSiteMenu: { next?: boolean; result?: Promise<void> } };
    testSiteMenu.next = next;
    delete testSiteMenu.result;
  }, checked);
  await action.trigger(page);
  await poll(() => worker.evaluate(async () => {
    const { testSiteMenu } = globalThis as unknown as { testSiteMenu: { result?: Promise<void> } };
    if (!testSiteMenu.result) return false;
    await testSiteMenu.result;
    return true;
  }), Boolean, 5000);
  return match;
}

export async function withActionBrowser<T>(run: (
  tabs: BrowserContext, action: Awaited<ReturnType<typeof connectAction>>,
) => Promise<T>) {
  const profile = await mkdtemp("/tmp/filler-chrome-action-");
  try {
    const { context: tabs, close } = await launch("logged-out", true, undefined, {
      actionProfile: profile, viewport: { width: 1280, height: 3900 },
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
  const browser = await chromium.connectOverCDP("http://127.0.0.1:" + port, { noDefaults: true });
  const cdp = await browser.newBrowserCDPSession();
  return {
    async trigger(page: Page) {
      await page.bringToFront();
      const { targetInfos } = await cdp.send("Target.getTargets", { filter: [{ type: "tab" }] });
      const target = targetInfos.find(({ url, embedderData }) => url === page.url() && embedderData?.tabActive);
      assert.ok(target, `No active tab target for ${page.url()}`);
      await cdp.send("Extensions.triggerAction", { id, targetId: target.targetId });
    },
    close: () => browser.close(),
  };
}
