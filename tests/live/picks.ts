import assert from "node:assert/strict";
import type { CheckContext } from "./run";
import { trace, waitForState, withBrowser } from "./lib/check";
import { difference, docCrop, save } from "./lib/pixels";

export default async function picks(context: CheckContext) {
  const { bridge, evidence } = context;
  await bridge.clear();
  await bridge.start();
  try {
    return await withBrowser(context, async (browser, page) => {
      const results = [];
      for (const name of ["wang", "perfloop", "warp"] as const) {
        const index = (await bridge.requests()).length;
        const root = await browser.open(page, name);
        await page.waitForLoadState("load", { timeout: 12_000 }).catch(() => {});
        await root.scrollIntoViewIfNeeded();
        await page.evaluate(() => document.fonts.ready);
        await Bun.sleep(700);
        const before = await docCrop(root);
        const response = await bridge.waitForRequest(index);
        const expected = name === "perfloop" ? "idle" : "picks-ready";
        assert.equal(response.result, name === "perfloop" ? "keep-all" : "keep", JSON.stringify(response));
        await waitForState(page, expected);
        const views = (await trace(page)).map(({ view }) => view);
        assert.ok(views.includes("waiting") && views.at(-1) === expected, `${name}: ${views.join(" → ")}`);
        const after = await docCrop(root);
        await save(evidence + "/" + name + "-before", before);
        assert.equal(difference(before, after), 0, `${name}: changed pixels`);
        await save(evidence + "/" + name, after);
        await Bun.sleep(15_000);
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await Bun.sleep(500);
        const requests = (await bridge.requests()).length - index;
        assert.equal(requests, 1, name);
        results.push(`${name} ${views.join(" → ")}, 0 changed pixels, ${requests} request, ${Math.round(response.ms)} ms`);
      }
      return results.join("; ");
    });
  } finally {
    await bridge.stop();
  }
}
