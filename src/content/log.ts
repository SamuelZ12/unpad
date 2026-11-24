import { randomId, sha256 } from "../shared/keys";
import type { LogEvent } from "../shared/types";

type SpecificEvent<T extends LogEvent = LogEvent> = T extends LogEvent
  ? Omit<T, "id" | "at" | "pageView" | "url"> : never;

export function createLog(url: string) {
  const pageView = randomId();
  return async (event: SpecificEvent) => {
    const at = new Date().toISOString();
    // A shown event or a restore has a stable ID within its page view for deduplication.
    const id = event.type === "reveal"
      ? randomId()
      : await sha256(JSON.stringify([
        pageView, event.type, event.cacheKey, event.type === "restore" ? event.sentenceId : null,
      ]));
    const entry: LogEvent = { ...event, id, at, pageView, url };
    const queued = await chrome.runtime.sendMessage({ type: "events", events: [entry] });
    if (!queued) throw new Error("Could not queue Filler Cut event");
  };
}
