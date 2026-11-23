import type { CheckContext } from "./run";
import { withBrowser } from "./lib/check";
import { withBridge } from "./lib/fade";
import { restoreOne } from "./lib/restore";

export default async function S8(context: CheckContext) {
  return withBridge(context, () => withBrowser(context, async (browser, page) => {
    const { elapsed, point, first } = await restoreOne(context, browser, page, true);
    return `sentence ${point.id} restored in ${elapsed.toFixed(1)} ms, ${first.faded} → ${first.faded - 1} faded, 0 other sentences changed after click/toggles/hold`;
  }));
}
