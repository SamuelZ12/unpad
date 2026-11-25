import { BRIDGE_URL, TOGGLE_COMMAND } from "../shared/config";
import { sha256 } from "../shared/keys";
import { documentRoute, type PageSnapshot } from "../shared/page-snapshot";
import { parseErrorResponse, parseEventsRequest, parseSelectRequest, parseSelectResponse } from "../shared/wire";

import { chromeEventQueue } from "./events";
import { activateDocument, addSites, deactivateSites, forgetSites, grantedSites, inspectDocument, optionalSiteMatches, ownsShortcut, restoreSites, siteEnabled } from "./sites";

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
  let siteChanges = Promise.resolve();
  function changeSites(change: () => Promise<void>) {
    const work = siteChanges.then(change);
    siteChanges = work.catch(console.warn);
    return work;
  }

  chrome.commands.onCommand.addListener((name, tab) => {
    if (name !== TOGGLE_COMMAND || tab?.id === undefined) return;
    void inspectDocument(tab.id).then((target) => {
      if (target && (!tab.url || documentRoute(target.url) === documentRoute(tab.url))) {
        return activateDocument(target, setLens);
      }
    }).catch(console.warn);
  });
  chrome.permissions.onAdded.addListener(({ origins }) => {
    void changeSites(() => addSites(optionalSiteMatches(origins), setLens));
  });
  chrome.permissions.onRemoved.addListener(({ origins }) => {
    void changeSites(() => deactivateSites(optionalSiteMatches(origins)));
  });
  chrome.runtime.onInstalled.addListener(({ reason, previousVersion }) => {
    const legacy = previousVersion === "0.0.2" || previousVersion === "0.0.3";
    void changeSites(reason === "update" && legacy ? forgetSites : restoreSites);
  });
  chrome.runtime.onStartup.addListener(() => { void changeSites(restoreSites); });
  const queueEvents = chromeEventQueue();
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.type === "hash" && typeof message.data === "string") {
      void sha256(message.data).then(reply);
      return true;
    }
    if (sender.url === chrome.runtime.getURL("popup.html")) {
      if (message?.type === "popup-press" && Number.isInteger(message.tabId) &&
        typeof message.url === "string" && typeof message.documentId === "string") {
        const { tabId, documentId, url } = message;
        void activateDocument({ tabId, documentId, url }, setLens).then(() => reply(true), () => reply(false));
        return true;
      }
      if (message?.type === "remove-site" && typeof message.match === "string" && optionalSiteMatches([message.match]).length) {
        const match: string = message.match;
        void changeSites(async () => {
          const removed = await chrome.permissions.remove({ origins: [match] });
          if (!removed && (await grantedSites()).includes(match)) throw new Error("The site still has access");
        }).then(() => reply(true), () => reply(false));
        return true;
      }
    }
    if (message?.type === "page-status-changed") {
      const tabId = sender.tab?.id;
      if (tabId === undefined || sender.frameId !== 0 || !message.page || typeof message.page !== "object") return;
      const { mode, status, lensOn } = message.page as PageSnapshot;
      let text = "";
      if ((mode === "site" || (mode === "page" && lensOn === true)) && status && !message.revealed) {
        if (status.kind === "reading") text = "…";
        if (status.kind === "failed") text = "!";
        if (status.kind === "cut" && Number.isSafeInteger(status.removed) && status.removed > 0) text = String(status.removed);
      }
      void chrome.action.setBadgeText({ tabId, text }).then(() => reply(true), () => reply(false));
      return true;
    }
    if (message?.type === "page-key") {
      const { documentId, tab } = sender;
      if (sender.frameId !== 0 || tab?.id === undefined || !documentId || typeof message.url !== "string") return;
      const target = { tabId: tab.id, documentId, url: message.url };
      // A browser shortcut and a page key event must never both toggle the lens.
      void ownsShortcut().then(async (assigned) => {
        if (!assigned) await activateDocument(target, setLens, true);
      }).then(() => reply(true), () => reply(false));
      return true;
    }
    if (message?.type === "site-enabled") {
      void siteEnabled(sender.url).then(reply, () => reply(false));
      return true;
    }
    if (message?.type === "events") {
      const request = parseEventsRequest(message);
      if (!request?.events.length) return;
      void queueEvents(request.events).then(() => reply(true), () => reply(false));
      return true;
    }
    if (message?.type !== "select") return;
    void (async () => {
      if (message.doc?.check && !await siteEnabled(sender.url)) return { error: "Site is no longer enabled" };
      return selectDoc(message.doc);
    })().then(reply, () => reply({ error: "Selection failed" }));
    return true;
  });
}
