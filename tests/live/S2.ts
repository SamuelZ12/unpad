// On Wang, Perfloop, and Warp with the lens on, compare the doc before and
// after picks. Its innerText and element count stay equal, with no extension
// classes or attributes inside it. Warp also keeps identical outerHTML.
// Every sentence sent to the bridge appears in innerText after whitespace is collapsed.
import assert from "node:assert/strict";
import type { Locator } from "playwright";
import { collapse } from "../../src/core/segment";
import type { CheckContext } from "./run";
import { roots } from "./lib/browser";
import { waitForState, withBrowser } from "./lib/check";
import { cacheEntry, withBridge } from "./lib/fade";
import { docCrop, save } from "./lib/pixels";

function snapshot(root: Locator) {
  return root.evaluate((element: HTMLElement) => ({
    text: element.innerText,
    count: element.querySelectorAll("*").length,
    extensionAttributes: [element, ...element.querySelectorAll("*")].flatMap((child) =>
      [...child.getAttributeNames(), ...child.classList].filter((name) => name.includes("filler-cut"))).length,
    html: element.outerHTML,
  }));
}

export default async function S2(context: CheckContext) {
  return withBridge(context, () => withBrowser(context, async (browser, page) => {
    const results: string[] = [];
    // Capture after styles load when the extension starts the bridge request.
    await browser.context.addInitScript((selectors) => {
      const originals: Record<string, { text: string; count: number; html: string }> = {};
      Object.defineProperty(window, "fillerCutOriginals", { value: originals });
      new MutationObserver(() => {
        if (document.documentElement.dataset.fillerCutState !== "waiting") return;
        for (const [name, selector] of Object.entries(selectors)) {
          const element = document.querySelector<HTMLElement>(selector);
          if (element?.innerText && !originals[name]) originals[name] = {
            text: element.innerText, count: element.querySelectorAll("*").length, html: element.outerHTML,
          };
        }
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-filler-cut-state"] });
    }, roots);
    for (const name of ["wang", "perfloop", "warp"] as const) {
      const index = (await context.bridge.requests()).length;
      const root = await browser.open(page, name);
      const row = await context.bridge.waitForRequest(index);
      const expected = name === "perfloop" ? "idle" : "faded";
      await waitForState(page, expected);
      const before = await page.evaluate((name) => {
        const win = window as unknown as { fillerCutOriginals: Record<string, { text: string; count: number; html: string }> };
        return win.fillerCutOriginals[name];
      }, name);
      const after = await snapshot(root);
      assert.ok(before, `${name}: missing pre-picks DOM snapshot`);
      assert.ok(after.text === before.text, `${name}: innerText changed from ${before.text.length} to ${after.text.length} chars`);
      assert.equal(after.count, before.count, name);
      assert.equal(after.extensionAttributes, 0, name);
      if (name === "warp") assert.ok(after.html === before.html, "Warp outerHTML changed");
      const cached = await cacheEntry(context, row.cacheKey);
      const text = collapse(after.text);
      assert.ok(cached.sentences.every((sentence) => text.includes(sentence)), name);
      await save(context.evidence + "/" + name, await docCrop(root));
      results.push(`${name}: ${cached.sentences.length} verbatim sentences, ${after.count} elements, 0 extension attributes`);
    }
    return results.join("; ");
  }));
}
