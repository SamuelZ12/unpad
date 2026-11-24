import { BRIDGE_URL } from "../shared/config";
import { parseErrorResponse, parseEventsRequest, parseSelectRequest, parseSelectResponse } from "../shared/wire";

import { chromeEventQueue } from "./events";

export async function selectDoc(body: unknown, fetcher: (input: URL, init: RequestInit) => Promise<Response> = fetch) {
  const request = parseSelectRequest(body);
  if (!request) return { error: "Invalid document" };
  try {
    const response = await fetcher(new URL("/select", BRIDGE_URL), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(45_000),
    });
    const answer: unknown = await response.json();
    if (!response.ok) return parseErrorResponse(answer) ?? { error: "Selection failed" };
    const picks = parseSelectResponse(answer);
    if (!picks || (picks.selection.kind === "keep" && picks.selection.keep.some((id) => id > request.sentences.length))) {
      return { error: "Invalid selection response" };
    }
    return picks;
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Selection failed" };
  }
}

if (typeof chrome !== "undefined") {
  let toggles = Promise.resolve();
  const queueEvents = chromeEventQueue();
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.type === "badge") {
      const tabId = sender.tab?.id;
      if (tabId === undefined || sender.frameId !== 0 || typeof message.text !== "string" ||
        !/^(?:…|!|[1-9]\d*)?$/.test(message.text)) return;
      void chrome.action.setBadgeText({ tabId, text: message.text }).then(() => reply(true), () => reply(false));
      return true;
    }
    if (message?.type === "toggle") {
      const write = toggles.then(async () => {
        const { lensOn } = await chrome.storage.local.get("lensOn");
        await chrome.storage.local.set({ lensOn: lensOn === false });
      });
      toggles = write.catch(console.warn);
      void write.then(() => reply(true), () => reply(false));
      return true;
    }
    if (message?.type === "events") {
      const request = parseEventsRequest(message);
      if (!request?.events.length) return;
      void queueEvents(request.events).then(() => reply(true), () => reply(false));
      return true;
    }
    if (message?.type !== "select") return;
    void selectDoc(message.doc).then(reply);
    return true;
  });
}
