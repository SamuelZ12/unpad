import { readPreferences } from "./preferences";
import { hostPermission } from "../shared/connection";
import type { LogEvent } from "../shared/types";
import { parseEventsRequest, parseEventsResponse } from "../shared/wire";

interface EventQueue {
  load(): Promise<readonly LogEvent[]>;
  save(pending: readonly LogEvent[]): Promise<void>;
  post(pending: readonly LogEvent[]): Promise<boolean>;
}

export function enqueueEvents(queue: EventQueue) {
  let tail = Promise.resolve();
  return (events: readonly LogEvent[]) => {
    const send = tail.then(async () => {
      const pending = [...await queue.load(), ...events];
      await queue.save(pending);
      if (await queue.post(pending)) await queue.save([]);
    });
    tail = send.catch(() => {});
    return send;
  };
}

export function chromeEventQueue(url: string) {
  // Older builds did not record a destination for their pendingEvents queue.
  const storageKey = `pendingEvents:${url}`;
  // Persist before posting because Chrome may stop the worker between events.
  return enqueueEvents({
    async load() {
      const { [storageKey]: pendingEvents } = await chrome.storage.local.get(storageKey);
      return parseEventsRequest({ events: pendingEvents })?.events ?? [];
    },
    async save(pendingEvents) {
      if (pendingEvents.length) await chrome.storage.local.set({ [storageKey]: pendingEvents });
      else await chrome.storage.local.remove(storageKey);
    },
    async post(events) {
      try {
        const { engine } = await readPreferences();
        if (engine?.kind !== "bridge" || engine.url !== url) return false;
        if (!await chrome.permissions.contains({ origins: [hostPermission(url)] })) return false;
        const response = await fetch(new URL("/events", url), {
          method: "POST",
          redirect: "error",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ events }),
          signal: AbortSignal.timeout(5000),
        });
        return response.ok && parseEventsResponse(await response.json())?.accepted === events.length;
      } catch {
        return false;
      }
    },
  });
}
