import { BRIDGE_URL } from "../shared/config";
import { sha256 } from "../shared/keys";
import { parseErrorResponse, parseEventsRequest, parseSelectRequest, parseSelectResponse } from "../shared/wire";

import { chromeEventQueue } from "./events";
import { activateSite, ownsShortcut, restoreSites } from "./sites";

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
  function setLens(on?: boolean) {
    const write = toggles.then(async () => {
      const { lensOn } = await chrome.storage.local.get("lensOn");
      await chrome.storage.local.set({ lensOn: on ?? (lensOn === false) });
    });
    toggles = write.catch(console.warn);
    return write;
  }
  chrome.action.onClicked.addListener((tab) => {
    void activateSite(tab, setLens).catch(console.warn);
  });
  const restore = () => { void restoreSites().catch(console.warn); };
  chrome.runtime.onInstalled.addListener(restore);
  chrome.runtime.onStartup.addListener(restore);
  const queueEvents = chromeEventQueue();
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.type === "hash" && typeof message.data === "string") {
      void sha256(message.data).then(reply);
      return true;
    }
    if (message?.type === "badge") {
      const tabId = sender.tab?.id;
      if (tabId === undefined || sender.frameId !== 0 || typeof message.text !== "string" ||
        !/^(?:…|!|[1-9]\d*)?$/.test(message.text)) return;
      void chrome.action.setBadgeText({ tabId, text: message.text }).then(() => reply(true), () => reply(false));
      return true;
    }
    if (message?.type === "toggle") {
      // A browser shortcut and a page key event must never both toggle the lens.
      void ownsShortcut().then((assigned) => assigned ? undefined : setLens())
        .then(() => reply(true), () => reply(false));
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
