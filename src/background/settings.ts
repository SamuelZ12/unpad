import { bridgeAddressHelp, hostPermission, issue, type Engine } from "../shared/connection";
import { chatgptOrigins, chatGPTModels, currentChatGPTSession, disconnectChatGPT, finishChatGPT, savedAccounts, startChatGPT } from "./chatgpt";
import { parseBridge, publicEngine, readPreferences } from "./preferences";
import { askProvider, providers, recognizeKey } from "./providers";

export function createSettings(trusted: Promise<unknown>) {
  let work = Promise.resolve<unknown>(undefined);
  function run<T>(fn: () => Promise<T>) {
    const next = work.then(() => trusted).then(fn);
    work = next.catch(() => {});
    return next;
  }

  const status = async () => {
    const { engine, about } = await readPreferences();
    const chatgptSession = await currentChatGPTSession();
    const { selectionIssue, issueAt, chatgptAccess } = await chrome.storage.session.get(["selectionIssue", "issueAt", "chatgptAccess"]);
    const signedOut = engine?.kind === "chatgpt" && !chatgptSession &&
      !(process.env.FILLER_CUT_DEV === "1" && chatgptAccess);
    const usageExpired = selectionIssue === issue.usage && typeof issueAt === "number" && Date.now() - issueAt >= 60_000;
    const error = signedOut ? issue.signedOut : usageExpired ? undefined : selectionIssue as string | undefined;
    const accounts = (await savedAccounts()).map(({ clientId, email }) => ({ clientId, email }));
    return { engine: publicEngine(engine), about, accounts, account: chatgptSession?.clientId, issue: error };
  };

  async function setEngine(engine: Engine | null) {
    const revoked = await disconnectChatGPT();
    await chrome.storage.session.remove("selectionIssue");
    await chrome.storage.local.set({ engine });
    return revoked ? {} : { error: "Signed out here. Disconnect the app in ChatGPT settings to finish." };
  }

  return {
    status,
    change: (message: { action?: string; value?: unknown }) => run(async () => {
      const { action, value } = message;
      const { engine } = await readPreferences();
      try {
        switch (action) {
          case "chatgpt":
            if (engine && engine.kind !== "chatgpt") return { error: issue.auth };
            if (!await chrome.permissions.contains({ origins: chatgptOrigins })) return { error: issue.permission };
            await startChatGPT(typeof value === "string" ? value : undefined);
            return {};
          case "key": {
            const key = typeof value === "string" ? value.trim() : "";
            const id = recognizeKey(key);
            if (!id || key.length > 1024 || /\s/.test(key)) return { error: issue.invalidKey };
            const provider = providers[id];
            if (!await chrome.permissions.contains({ origins: [hostPermission(provider.origin)] })) {
              return { error: issue.permission };
            }
            await askProvider(id, key, provider.model)("Reply with the digit 1.");
            return setEngine({ kind: "key", provider: id, key, model: provider.model });
          }
          case "bridge": {
            const url = parseBridge(value);
            if (!url) return { error: bridgeAddressHelp };
            if (!await chrome.permissions.contains({ origins: [hostPermission(url)] })) return { error: issue.permission };
            return setEngine({ kind: "bridge", url });
          }
          case "disconnect":
            return setEngine(null);
          case "about":
            if (typeof value !== "string" || value.length > 4000) return { error: "Keep your notes under 4,000 characters." };
            await chrome.storage.local.set({ about: value.trim() });
            return {};
          case "model":
            if (engine && engine.kind !== "bridge" && typeof value === "string" && /^[a-zA-Z0-9_./:-]{1,150}$/.test(value)) {
              const { selectionIssue } = await chrome.storage.session.get("selectionIssue");
              if (selectionIssue === issue.model || selectionIssue === issue.reply || selectionIssue === issue.failed) {
                await chrome.storage.session.remove("selectionIssue");
              }
              await chrome.storage.local.set({ engine: { ...engine, model: value } });
              return {};
            }
            return { error: issue.model };
          case "models":
            return engine?.kind === "chatgpt" ? { models: await chatGPTModels() } : {};
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        return { error: Object.values(issue).find((text) => text === message) ?? issue.failed };
      }
      return { error: issue.failed };
    }),
    callback: (tabId: number, query: string) => run(async () => {
      let error: string | undefined;
      try {
        if (!await finishChatGPT(tabId, query)) return { error: issue.auth };
      } catch (err) {
        const message = err instanceof Error ? err.message : "";
        error = Object.values(issue).find((text) => text === message) ?? issue.auth;
      }
      if (error) await chrome.storage.session.set({ selectionIssue: error });
      else await chrome.storage.session.remove("selectionIssue");
      return {};
    }),
  };
}
