import assert from "node:assert/strict";
import { launch, type Mode } from "./lib/browser";
import { difference, docCrop, poll, save } from "./lib/pixels";

export default async function load({ evidence }: { evidence: string }) {
  const results: string[] = [];
  for (const mode of ["logged-out", "replay"] satisfies Mode[]) {
    const browser = await launch(mode);
    try {
      const { context, open } = browser;
      const page = context.pages()[0];
      const worker = await poll(async () => context.serviceWorkers()[0]?.url(), (url) => !!url, 5000);
      assert.match(worker ?? "", /^chrome-extension:\/\/.+\/sw\.js$/);
      for (const name of mode === "replay" ? ["wang", "perfloop"] as const : ["wang", "perfloop", "warp"] as const) {
        try {
          const root = await open(page, name);
          await page.waitForLoadState("load", { timeout: 12_000 }).catch(() => {});
          await root.scrollIntoViewIfNeeded();
          await page.evaluate(() => document.fonts.ready);
          await Bun.sleep(1000);
          const reference = await docCrop(root);
          await save(`${evidence}/${mode}-${name}-0`, reference);
          const start = Date.now();
          const changes = [];
          for (const ms of [2500, 5000]) {
            await Bun.sleep(Math.max(0, start + ms - Date.now()));
            const image = await docCrop(root);
            changes.push(difference(reference, image));
            await save(`${evidence}/${mode}-${name}-${ms}`, image);
          }
          results.push(`${mode}/${name}: ${changes.join("/")} changed pixels over ${Date.now() - start} ms`);
        } catch (error) {
          results.push(`${mode}/${name}: ${error}`);
          process.exitCode = 1;
        }
      }
    } finally {
      await browser.close();
    }
  }
  const summary = results.join("\n");
  assert.ok(results.every((result) => /: 0\/0 changed pixels/.test(result)), summary);
  return summary;
}
