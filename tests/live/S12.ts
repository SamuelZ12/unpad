import assert from "node:assert/strict";
import type { Locator } from "playwright";
import { segment } from "../../src/core/segment";
import type { CheckContext } from "./run";
import { roots, state } from "./lib/browser";
import { trace, waitForState, withBrowser } from "./lib/check";
import { withBridge } from "./lib/fade";
import { difference, docCrop, save } from "./lib/pixels";

const shortStatus = "https://x.com/xavier_clegg/status/2124646690384986459";
const otherSite = "https://www.anthropic.com/engineering/building-effective-agents";

async function observeUntouched(root: Locator, evidence: string) {
  await root.waitFor({ state: "visible" });
  await root.page().waitForLoadState("load", { timeout: 10_000 });
  await root.scrollIntoViewIfNeeded();
  await root.page().evaluate(() => document.fonts.ready);
  const original = await docCrop(root);
  await Bun.sleep(1000);
  const after = await docCrop(root);
  await save(evidence + "-before", original);
  await save(evidence + "-after", after);
  const changed = difference(original, after);
  assert.equal(changed, 0, `${root.page().url()}: ${changed} changed pixels`);
  return changed;
}

export default async function S12(context: CheckContext) {
  return withBridge(context, () => withBrowser(context, async (_browser, page) => {
    const requests = Bun.file(context.bridge.data + "/requests.jsonl");
    const lineCount = async () => await requests.exists()
      ? (await requests.text()).split("\n").filter(Boolean).length : 0;
    const before = await lineCount();

    await page.goto(shortStatus, { waitUntil: "domcontentloaded" });
    const post = page.locator(roots.perfloop).first();
    const count = segment(await post.innerText({ timeout: 15_000 })).length;
    assert.ok(count > 0 && count < 6, `Short status has ${count} sentences`);
    await waitForState(page, "idle", 3000);
    const shortPixels = await observeUntouched(post, context.evidence + "/short-status");
    assert.deepEqual((await trace(page)).map(({ view }) => view), ["idle"]);
    assert.deepEqual(await state(page), { view: "idle", faded: 0 });
    const afterShort = await lineCount();
    assert.equal(afterShort - before, 0, "Short status added bridge log lines");

    await page.goto(otherSite, { waitUntil: "domcontentloaded" });
    const article = page.locator("main article").first();
    const otherPixels = await observeUntouched(article, context.evidence + "/other-site");
    assert.deepEqual(await trace(page), []);
    const afterOther = await lineCount();
    assert.equal(afterOther - afterShort, 0, "Other site added bridge log lines");
    return `short status ${count} sentences, ${shortPixels} changed pixels, 0 log lines; other site ${otherPixels} changed pixels, 0 log lines (${page.url()})`;
  }));
}
