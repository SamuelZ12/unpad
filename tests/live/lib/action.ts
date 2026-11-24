import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium, type BrowserContext, type Page } from "playwright";

export async function extensionWorker(context: BrowserContext) {
  return context.serviceWorkers()[0] ?? context.waitForEvent("serviceworker", { timeout: 5000 });
}

export async function extensionId(context: BrowserContext) {
  return new URL((await extensionWorker(context)).url()).hostname;
}

export async function extensionSettings(context: BrowserContext, change: (page: Page, id: string) => Promise<void>) {
  const id = await extensionId(context);
  const settings = await context.newPage();
  try {
    await settings.goto("chrome://extensions/shortcuts");
    await change(settings, id);
  } finally {
    await settings.close();
  }
}

export async function clearActionShortcut(context: BrowserContext) {
  await extensionSettings(context, (settings, id) => settings.evaluate((extensionId) => {
    const { developerPrivate } = chrome as unknown as {
      developerPrivate: { updateExtensionCommand(update: object, done: () => void): void };
    };
    return new Promise<void>((resolve, reject) => {
      developerPrivate.updateExtensionCommand({ extensionId, commandName: "_execute_action", keybinding: "" }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });
  }, id));
}

export async function preapproveHost(context: BrowserContext, match: string) {
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
