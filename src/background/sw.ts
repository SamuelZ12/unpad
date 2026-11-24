import { BRIDGE_URL } from "../shared/config";
import { sha256 } from "../shared/keys";
import { parseErrorResponse, parseEventsRequest, parseSelectRequest, parseSelectResponse } from "../shared/wire";

import { chromeEventQueue } from "./events";
import { activateDocument, forgetSites, ownsShortcut, restoreSites, setSite, siteEnabled, siteMenuId, syncSiteMenu } from "./sites";

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
  const testSiteMenu: { next?: boolean; result?: Promise<void> } = {};
  function setLens(on?: boolean) {
    const write = toggles.then(async () => {
      const { lensOn } = await chrome.storage.local.get("lensOn");
      await chrome.storage.local.set({ lensOn: on ?? (lensOn === false) });
    });
    toggles = write.catch(console.warn);
    return write;
  }
  chrome.action.onClicked.addListener((tab) => {
    if (process.env.FILLER_CUT_DEV === "1" && testSiteMenu.next !== undefined) {
      const checked = testSiteMenu.next;
      delete testSiteMenu.next;
      // CDP can trigger the action's user gesture but cannot click the native menu.
      testSiteMenu.result = onSiteMenuClick({ menuItemId: siteMenuId, checked }, tab);
      void testSiteMenu.result.catch(console.warn);
      return;
    }
    void activateDocument(tab, setLens).catch(console.warn);
  });
  function refreshMenu() {
    void syncSiteMenu().catch(console.warn);
  }
  async function onSiteMenuClick(info: Pick<chrome.contextMenus.OnClickData, "menuItemId" | "checked" | "pageUrl">, tab?: chrome.tabs.Tab) {
    if (info.menuItemId !== siteMenuId || !tab || info.checked === undefined) return;
    try {
      await setSite({ ...tab, url: tab.url ?? info.pageUrl }, info.checked, setLens);
    } finally {
      await syncSiteMenu();
    }
  }
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    void onSiteMenuClick(info, tab).catch(console.warn);
  });
  if (process.env.FILLER_CUT_DEV === "1") Object.assign(globalThis, { testSiteMenu });
  chrome.tabs.onActivated.addListener(refreshMenu);
  chrome.tabs.onUpdated.addListener((_id, _change, tab) => { if (tab.active) refreshMenu(); });
  chrome.windows.onFocusChanged.addListener(refreshMenu);
  chrome.permissions.onAdded.addListener(refreshMenu);
  chrome.permissions.onRemoved.addListener(refreshMenu);
  chrome.runtime.onInstalled.addListener(({ reason, previousVersion }) => {
    // Both old releases could enable a site from the action. Ask for menu opt-in again.
    const legacy = previousVersion === "0.0.2" || previousVersion === "0.0.3";
    const sites = reason === "update" && legacy ? forgetSites() : restoreSites();
    void sites.catch(console.warn);
    chrome.contextMenus.create({
      id: siteMenuId, title: "Always run on this site", type: "checkbox", contexts: ["action"],
      documentUrlPatterns: ["https://*/*", "http://*/*"],
    }, () => {
      if (chrome.runtime.lastError) console.warn(chrome.runtime.lastError.message);
      refreshMenu();
    });
  });
  chrome.runtime.onStartup.addListener(() => { void restoreSites().then(refreshMenu).catch(console.warn); });
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
      void ownsShortcut().then(async (assigned) => {
        if (assigned) return false;
        if (message.mode === "site" && await siteEnabled(sender.url)) await setLens();
        return true;
      }).then(reply, () => reply(false));
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
