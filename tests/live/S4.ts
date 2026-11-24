// Open the Warp /blog/ URL with the lens on and an empty cache. Within 1000 ms
// of the bridge response, at least 8 prose sentences are faded. Headings, tables,
// code blocks, image captions, navigation links, and footer text stay full strength.
import assert from "node:assert/strict";
import type { CheckContext } from "./run";
import { withBrowser } from "./lib/check";
import { studyFade, withBridge } from "./lib/fade";

export default async function S4(context: CheckContext) {
  await context.bridge.clear();
  return withBridge(context, () => withBrowser(context, async (browser, page) => {
    const result = await studyFade(context, browser, page, "warp", 8);
    assert.equal(result.response.source, "pi");
    return `${result.observed}/${result.expected.length} faded sentences visible in ${result.elapsed.toFixed(1)} ms, ${result.layout.excludedHits} excluded spans`;
  }));
}
