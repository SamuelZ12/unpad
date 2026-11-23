import assert from "node:assert/strict";
import type { CheckContext } from "./run";
import type { Doc } from "../../src/shared/types";
import { collapse } from "../../src/core/segment";
import { launch, type Reference } from "./lib/browser";
import { difference, docCrop, poll, save } from "./lib/pixels";
import type { Page } from "playwright";

export async function debug(page: Page): Promise<{ docs: Doc[]; extractMs: number }> {
  return page.locator("html").evaluate((html) => JSON.parse(html.dataset.fillerCutDebug ?? '{"docs":[]}'));
}

export default async function checkExtract({ evidence, mode }: CheckContext) {
  const results: string[] = [];
  const live = new Map<Reference, readonly string[]>();
  for (const current of mode === "logged-in" ? [mode] as const : ["logged-out", "replay"] as const) {
    const browser = await launch(current);
    try {
      const page = browser.context.pages()[0];
      const names: Reference[] = current === "logged-out" ? ["wang", "perfloop", "warp"] : ["wang", "perfloop"];
      for (const name of names) {
        const root = await browser.open(page, name);
        await page.evaluate(() => document.fonts.ready);
        const { docs, extractMs } = await poll(() => debug(page), (result) => result.docs.length > 0, 5000);
        const { sentences, surface } = docs[0];
        const expected = { wang: ["x-article", 26, 32], perfloop: ["x-post", 10, 10], warp: ["blog", 65, 85] } as const;
        const [kind, min, max] = expected[name];
        const summary = `${current}/${name} ${docs.length} doc, ${sentences.length} sentences, ${extractMs.toFixed(2)} ms`;
        assert.ok(docs.length === 1 && surface === kind && sentences.length >= min && sentences.length <= max, summary);
        const text = collapse(await root.innerText());
        assert.ok(sentences.every((sentence) => text.includes(sentence)), `${summary}, missing from innerText: ${sentences.filter((sentence) => !text.includes(sentence)).join(" | ")}`);
        if (current === "logged-out") live.set(name, sentences);
        if (current === "replay") assert.deepEqual(sentences, live.get(name), summary);
        await page.waitForLoadState("load", { timeout: 12_000 }).catch(() => {});
        await root.scrollIntoViewIfNeeded();
        await Bun.sleep(1000);
        const before = await docCrop(root);
        await Bun.sleep(500);
        const after = await docCrop(root);
        await save(`${evidence}/${current}-${name}`, after);
        assert.equal(difference(before, after), 0, summary);
        results.push(summary);
      }
    } finally {
      await browser.close();
    }
  }
  return results.join("; ");
}
