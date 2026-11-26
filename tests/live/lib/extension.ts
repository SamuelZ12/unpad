import type { BrowserContext, Page } from "playwright";

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

// Chromium's settings pre-approve the prompt. The popup still has to request the grant.
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

export async function requestHostFromOptions(page: Page, origin: string) {
  await page.evaluate((origin) => {
    const button = document.createElement("button");
    button.id = "test-host-grant";
    button.textContent = "Grant test access";
    button.onclick = async () => {
      button.dataset.granted = String(await chrome.permissions.request({ origins: [origin] }));
    };
    document.body.append(button);
  }, origin);
  const button = page.locator("#test-host-grant");
  await button.click();
  await page.locator("#test-host-grant[data-granted=true]").waitFor({ timeout: 5000 });
  await button.evaluate((node) => node.remove());
}
