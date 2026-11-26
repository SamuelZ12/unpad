import { TOGGLE_COMMAND } from "../shared/config";
import { hostPermission, issue } from "../shared/connection";
import { sha256 } from "../shared/keys";
import { documentRoute, type PageSnapshot, type PressTarget } from "../shared/page-snapshot";
import { parseEventsRequest, parseSelectRequest } from "../shared/wire";
import { cancelChatGPT } from "./chatgpt";
import { chromeEventQueue } from "./events";
import { initialEngine, readPreferences } from "./preferences";
import { bridgeSelector, localSelector, type Selector } from "./selectors";
import { providers } from "./providers";
import { createSettings } from "./settings";
import { activateDocument, addSites, deactivateSites, forgetSites, grantedSites, inspectDocument, optionalSiteMatches, ownsShortcut, restoreSites, siteEnabled } from "./sites";

export async function selectDoc(body: unknown, select: Selector) {
  const request = parseSelectRequest(body);
  if (!request) return { error: issue.failed };
  try {
    return await select(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const known = Object.values(issue).find((text) => text === message);
    return { error: known ?? issue.failed };
  }
}

if (typeof chrome !== "undefined") {
  const trusted = Promise.all([
    chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
    chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
  ]);
  if (process.env.FILLER_CUT_DEV === "1") {
    Object.assign(globalThis, {
      async fillerCutTestChatGPT(token: string) {
        await trusted;
        await chrome.storage.session.set({ chatgptAccess: { sessionId: "dev", token, expiresAt: Date.now() + 15 * 60_000 } });
        await chrome.storage.local.set({ engine: { kind: "chatgpt", model: providers.chatgpt.model } });
      },
    });
  }
  const optionsUrl = chrome.runtime.getURL("options.html");
  const callbackUrl = chrome.runtime.getURL("callback.html");
  const settings = createSettings(trusted);
  chrome.tabs.onRemoved.addListener((tabId) => { void cancelChatGPT(tabId).catch(() => {}); });

  async function pushPreferences(changes: Record<string, chrome.storage.StorageChange>) {
    const session = changes.chatgptSession;
    const sessionId = (session?.newValue as { id?: string } | undefined)?.id;
    const signedIn = !!sessionId && sessionId !== (session?.oldValue as { id?: string } | undefined)?.id;
    const restart = !!(signedIn || changes.engine || changes.about);
    if (!changes.lensOn && !restart) return;
    const { engine } = await readPreferences();
    const { lensOn } = await chrome.storage.local.get("lensOn");
    const message = { type: "reading-preferences", connected: !!engine, lensOn: lensOn !== false,
      restart };
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.flatMap(({ id }) =>
      id === undefined ? [] : chrome.tabs.sendMessage(id, message, { frameId: 0 }).catch(() => {})));
  }
  chrome.storage.local.onChanged.addListener((changes) => { void pushPreferences(changes).catch(() => {}); });

  async function press(target: PressTarget, existingScript = false) {
    await trusted;
    if ((await readPreferences()).engine) return activateDocument(target, setLens, existingScript);
    const { tabId, documentId, url } = target;
    const show = () => chrome.tabs.sendMessage(tabId, { type: "needs-setup", url }, { documentId }).catch(() => false);
    if (!await show() && !existingScript) {
      await chrome.scripting.executeScript({ target: { tabId, documentIds: [documentId] }, files: ["page.js"] });
      await show();
    }
  }

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
    void inspectDocument(tab.id).then(async (target) => {
      if (target && (!tab.url || documentRoute(target.url) === documentRoute(tab.url))) {
        return press(target);
      } else if (!target && !(await readPreferences()).engine) {
        await chrome.runtime.openOptionsPage();
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
    if (reason === "install" && !initialEngine) void chrome.tabs.create({ url: optionsUrl });
  });
  chrome.runtime.onStartup.addListener(() => { void changeSites(restoreSites); });
  const queueEvents = new Map<string, ReturnType<typeof chromeEventQueue>>();
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.type === "reading-preferences" && sender.frameId === 0) {
      void trusted.then(async () => {
        const { engine } = await readPreferences();
        const { lensOn } = await chrome.storage.local.get("lensOn");
        reply({ connected: !!engine, lensOn: lensOn !== false });
      }).catch(() => reply({ connected: false }));
      return true;
    }
    if (sender.url === optionsUrl || sender.url === chrome.runtime.getURL("popup.html")) {
      if (message?.type === "connection") {
        void trusted.then(settings.status).then(reply, () => reply({}));
        return true;
      }
      if (message?.type === "manage-usage") {
        void chrome.storage.session.get("selectionIssue").then(async ({ selectionIssue }) => {
          if (selectionIssue === issue.usage) await chrome.storage.session.remove("selectionIssue");
        }).then(reply, () => reply(false));
        return true;
      }
      if (sender.url === optionsUrl && message?.type === "settings") {
        void settings.change(message).then(reply, () => reply({ error: issue.failed }));
        return true;
      }
    }
    if (sender.url?.split("#", 1)[0] === callbackUrl && sender.tab?.id !== undefined &&
        message?.type === "chatgpt-callback" && typeof message.query === "string") {
      void settings.callback(sender.tab.id, message.query).then(reply, () => reply({ error: issue.auth }));
      return true;
    }
    if (message?.type === "hash" && typeof message.data === "string") {
      void sha256(message.data).then(reply);
      return true;
    }
    if (sender.url === chrome.runtime.getURL("popup.html")) {
      if (message?.type === "popup-press" && Number.isInteger(message.tabId) &&
        typeof message.url === "string" && typeof message.documentId === "string") {
        const { tabId, documentId, url } = message;
        void press({ tabId, documentId, url }).then(() => reply(true), () => reply(false));
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
        if (!assigned) await press(target, true);
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
      void trusted.then(async () => {
        const { engine } = await readPreferences();
        if (engine?.kind !== "bridge" || message.bridge !== await sha256(engine.url) ||
            !await chrome.permissions.contains({ origins: [hostPermission(engine.url)] })) return;
        let queue = queueEvents.get(engine.url);
        if (!queue) queueEvents.set(engine.url, queue = chromeEventQueue(engine.url));
        await queue(request.events);
      }).then(() => reply(true), () => reply(false));
      return true;
    }
    if (message?.type !== "select" || sender.frameId !== 0 || sender.tab?.id === undefined) return;
    void (async () => {
      if (message.doc?.check && !await siteEnabled(sender.url)) return { error: "Site is no longer enabled" };
      await trusted;
      const { engine, about, sessionId } = await readPreferences();
      if (!engine) return { error: issue.setup };
      if (engine.kind === "bridge" && !await chrome.permissions.contains({ origins: [hostPermission(engine.url)] })) {
        return { error: issue.permission };
      }
      if (engine.kind === "chatgpt") {
        const { selectionIssue, issueAt } = await chrome.storage.session.get(["selectionIssue", "issueAt"]);
        if (selectionIssue === issue.usage && typeof issueAt === "number" && Date.now() - issueAt < 60_000) {
          return { error: issue.usage };
        }
        if (selectionIssue === issue.usage) await chrome.storage.session.remove(["selectionIssue", "issueAt"]);
      }

      const selector = engine.kind === "bridge" ? bridgeSelector(engine.url) : localSelector(engine, about, sessionId);
      const result = await selectDoc(message.doc, selector);
      if (engine.kind !== "bridge") {
        const latest = await readPreferences();
        if (latest.about === about && JSON.stringify(latest.engine) === JSON.stringify(engine) &&
            (engine.kind !== "chatgpt" || sessionId === latest.sessionId || !latest.sessionId)) {
          const current = (await chrome.storage.session.get("selectionIssue")).selectionIssue;
          if ("error" in result && (current !== issue.usage || result.error === issue.usage)) {
            await chrome.storage.session.set({ selectionIssue: result.error, issueAt: Date.now() });
          } else if (!("error" in result) && current !== issue.usage) {
            await chrome.storage.session.remove(["selectionIssue", "issueAt"]);
          }
        }
      }
      return engine.kind === "bridge" && !("error" in result)
        ? { ...result, bridge: await sha256(engine.url) } : result;
    })().then(reply, () => reply({ error: "Selection failed" }));
    return true;
  });
}
