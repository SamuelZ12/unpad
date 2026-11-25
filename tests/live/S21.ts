import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { CheckContext } from "./run";
import { TOGGLE_COMMAND } from "../../src/shared/config";
import { extensionWorker } from "./lib/action";
import { launch } from "./lib/browser";
import { poll } from "./lib/pixels";
import { bridgeUrl } from "./lib/bridge";

export default async function S21({ evidence }: CheckContext) {
  const root = await mkdtemp("/tmp/filler-shortcut-upgrade-");
  try {
    const archive = Bun.spawn(["git", "archive", "f22d0cd", "src", "scripts/build.ts"], { stdout: "pipe" });
    const unpack = Bun.spawn(["tar", "-x", "-C", root], { stdin: archive.stdout });
    assert.deepEqual(await Promise.all([archive.exited, unpack.exited]), [0, 0]);
    const build = Bun.spawn([process.execPath, "scripts/build.ts"], {
      cwd: root, env: { ...process.env, BRIDGE_URL: bridgeUrl }, stderr: "inherit",
    });
    assert.equal(await build.exited, 0);

    const extension = join(root, "dist/extension");
    const { context, close } = await launch("logged-out", true, undefined, { extension });
    try {
      const worker = await extensionWorker(context);
      const extensionHost = new URL(worker.url()).hostname;
      const readCommands = () => chrome.commands.getAll().then((commands) => ({
        version: chrome.runtime.getManifest().version, commands,
      }));
      const before = await worker.evaluate(readCommands);
      assert.equal(before.version, "0.2.0");
      const oldKey = before.commands.find(({ name }) => name === "_execute_action")?.shortcut;
      assert.ok(oldKey, "0.2.0 browser shortcut was not assigned");
      const updated = await Bun.file("dist/extension/manifest.json").json();

      const settings = context.pages()[0];
      await settings.goto("chrome://extensions/");
      const developer = settings.locator("#devMode");
      const devMode = () => developer.evaluate((toggle) => (toggle as HTMLElement & { checked: boolean }).checked);
      if (!await devMode()) await developer.click();
      await poll(devMode, Boolean, 3000);
      const reload = settings.locator(`extensions-item[id="${extensionHost}"] #dev-reload-button`);
      await cp(resolve("dist/extension"), extension, { recursive: true });
      await reload.click({ timeout: 5000 });
      type ExtensionInfo = { version: string; state: string };
      await poll(() => settings.evaluate((id) => new Promise<ExtensionInfo | undefined>((resolve) => {
        const { developerPrivate } = chrome as unknown as {
          developerPrivate: { getExtensionInfo(id: string, callback: (info?: ExtensionInfo) => void): void };
        };
        developerPrivate.getExtensionInfo(id, resolve);
      }), extensionHost), (item) => !!item && item.version === updated.version && item.state === "ENABLED", 5000);
      const wake = await context.newPage();
      await wake.route("https://x.com/home", (route) => route.fulfill({ contentType: "text/html", body: "<p>Home</p>" }));
      await wake.goto("https://x.com/home");
      const next = await poll(async () => context.serviceWorkers().find((worker) =>
        worker.url() === `chrome-extension://${extensionHost}/${updated.background.service_worker}`), Boolean, 5000);
      assert.ok(next);
      const after = await next.evaluate(readCommands);
      await Bun.write(join(evidence, "commands.json"), JSON.stringify({ before, after }, null, 2) + "\n");
      assert.equal(after.version, updated.version);
      const key = after.commands.find(({ name }) => name === TOGGLE_COMMAND)?.shortcut;
      assert.equal(key, oldKey, `0.2.0 used ${oldKey}; after reload: ${JSON.stringify(after.commands)}`);
      return `same unpacked install reloaded from ${before.version} to ${after.version}; ${oldKey} moved from _execute_action to ${TOGGLE_COMMAND}`;
    } finally {
      await close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
