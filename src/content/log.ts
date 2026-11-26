import { randomId, sha256 } from "../shared/keys";
import type { LogEvent } from "../shared/types";

type SpecificEvent<T extends LogEvent = LogEvent> = T extends LogEvent
  ? Omit<T, "id" | "at" | "pageView" | "url"> : never;

export function createLog(url: string) {
  const pageView = randomId();
  return async (bridge: string, ...events: SpecificEvent[]) => {
    const at = new Date().toISOString();
    const entries = await Promise.all(events.map(async (event): Promise<LogEvent> => {
      const occurrence = event.type === "restore" || event.type === "recut" ? [randomId()] : [];
      const id = event.type === "reveal"
        ? randomId()
        : await sha256(JSON.stringify([
          pageView, event.type, event.cacheKey, "sentenceId" in event ? event.sentenceId : null, ...occurrence,
        ]));
      return { ...event, id, at, pageView, url };
    }));
    const queued = await chrome.runtime.sendMessage({ type: "events", bridge, events: entries });
    if (!queued) throw new Error("Could not queue Unpad event");
  };
}
