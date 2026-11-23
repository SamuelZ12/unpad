import assert from "node:assert/strict";
import type { CheckContext } from "./run";
import { withBrowser } from "./lib/check";
import { studyFade, withBridge } from "./lib/fade";

export default async function S1(context: CheckContext) {
  await context.bridge.clear();
  return withBridge(context, () => withBrowser(context, async (browser, page) => {
    const result = await studyFade(context, browser, page, "wang", 3);
    assert.equal(result.response.source, "pi");
    return `${result.observed}/${result.expected.length} faded sentences visible in ${result.elapsed.toFixed(1)} ms, ${result.protectedPixels} changed title/byline pixels, ${result.response.piCalls} Pi call(s)`;
  }));
}
