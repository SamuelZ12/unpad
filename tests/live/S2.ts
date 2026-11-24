import assert from "node:assert/strict";
import type { CheckContext } from "./run";
import { roots } from "./lib/browser";
import { toggle, waitForState, withBrowser } from "./lib/check";
import { referenceCut, snapshot, withBridge } from "./lib/cut";

export default async function S2(context: CheckContext) {
  return withBridge(context, () => withBrowser(context, async (browser, page) => {
    await browser.context.addInitScript((selectors) => {
      const originals = new Map<string, { text: string; node: Element; html: string }>();
      Object.defineProperty(window, "verifyOriginals", { value: originals });
      new MutationObserver(() => {
        if (document.documentElement.dataset.fillerCutState !== "waiting") return;
        for (const selector of selectors) {
          const node = document.querySelector<HTMLElement>(selector);
          if (node?.innerText && !originals.has(selector)) {
            originals.set(selector, { text: node.innerText, html: node.outerHTML, node });
          }
        }
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-filler-cut-state"] });
    }, [roots.wang, roots.warp]);
    const results = [];
    for (const name of ["wang", "warp"] as const) {
      const { root, ids } = await referenceCut(context, browser, page, name);
      await toggle(page);
      await waitForState(page, "picks-ready");
      const before = await page.evaluate((selector) => {
        const win = window as unknown as { verifyOriginals: Map<string, { text: string; node: Element; html: string }> };
        const original = win.verifyOriginals.get(selector);
        return original && { text: original.text, html: original.html, same: original.node === document.querySelector(selector) };
      }, roots[name]);
      assert.ok(before?.same, `${name}: site replaced the original article root`);
      const after = await snapshot(root);
      assert.equal(after.text, before.text, name);
      if (name === "warp") assert.equal(after.html, before.html, "Warp source HTML changed");
      assert.equal(await root.locator("[data-filler-cut-fragment], [data-filler-cut-marker], [data-filler-cut-collapsed]").count(), 0);
      results.push(`${name} ${ids.length} removed, lens off restores original text and markup`);
      await toggle(page);
      await waitForState(page, "faded");
    }
    return results.join(" | ");
  }));
}
