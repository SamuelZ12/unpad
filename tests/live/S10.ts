import assert from "node:assert/strict";
import { roots } from "./lib/browser";
import { atMost, toggle, waitForState, withBrowser } from "./lib/check";
import { assertCuts, captureDomErrors, expandRun, referenceCut, withBridge } from "./lib/cut";
import { detachReplayCell, rebuildReplayCell } from "./lib/replay";
import { followStatus } from "./S11";
import type { CheckContext } from "./run";

export default async function S10(context: CheckContext) {
  return withBridge(context, () => withBrowser(context, async (browser, page) => {
    const replay = context.mode === "replay";
    const assertConsole = captureDomErrors(page);
    try {
      const wang = await referenceCut(context, browser, page, "wang");
      const { root, entry } = wang;
      const { remaining, group } = await expandRun(root, entry);
      const before = (await context.bridge.requests()).length;
      const scroll = await page.evaluate(() => scrollY);
      const times: number[] = [];
      let deepest = 0;
      for (let i = 0; i < (replay ? 5 : 1); i++) {
        if (replay) await detachReplayCell(page);
        else {
          for (let step = 0; step < 12; step++) {
            deepest = Math.max(deepest, await page.evaluate(() => {
              scrollTo(0, document.documentElement.scrollHeight);
              return scrollY;
            }));
            await Bun.sleep(600);
            if (!await page.locator(roots.wang).count()) break;
          }
        }
        assert.equal(await page.locator(roots.wang).count(), 0, `Wang stayed mounted through scrollY=${deepest}`);
        await waitForState(page, "idle", 1000);
        if (replay) await rebuildReplayCell(page, scroll);
        else await page.evaluate(() => scrollTo(0, 0));
        await root.waitFor({ state: "attached" });
        const returned = Date.now();
        if (remaining.length || entry.key?.length) await waitForState(page, "faded", 1000);
        await assertCuts(root, entry, remaining);
        const elapsed = Date.now() - returned;
        times.push(elapsed);
        atMost(elapsed, 200, "Rebuilt article to cuts");
      }
      await toggle(page);
      await waitForState(page, "picks-ready");
      await assertCuts(root, entry, []);
      await toggle(page);
      await waitForState(page, "faded");
      await assertCuts(root, entry, remaining);
      assert.equal((await context.bridge.requests()).length, before, "Rebuild asked for new picks");
      const navigation = await followStatus(context, page, wang);
      return `${times.length} ${replay ? "replay" : "virtualized"} rebuild(s) in ${times.join("/")} ms, run ${group.join("/")} stays expanded through rebuild and toggle, ${navigation}, no React DOM errors`;
    } finally {
      await assertConsole(context.evidence + "/console.json");
    }
  }));
}
