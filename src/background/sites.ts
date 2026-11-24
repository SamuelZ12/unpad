const actionCommand = "_execute_action";

export async function ownsShortcut() {
  return (await chrome.commands.getAll()).some(({ name, shortcut }) => name === actionCommand && !!shortcut);
}

async function registerSite(match: string) {
  const filter = { ids: [match] };
  const registered = async () => (await chrome.scripting.getRegisteredContentScripts(filter)).length > 0;
  if (await registered()) return;
  try {
    await chrome.scripting.registerContentScripts([{
      id: match, matches: [match], js: ["main.js"], persistAcrossSessions: true,
    }]);
  } catch (error) {
    if (!await registered()) throw error;
  }
}

async function grantedSites() {
  const { origins = [] } = await new Promise<chrome.permissions.Permissions>((resolve) => chrome.permissions.getAll(resolve));
  // Only the exact scheme, host, and port grants from the action enable generic extraction.
  return origins.filter((origin) => /^https?:\/\/(?:\[[^\]]+\]|[^*:]+):\d+\/\*$/.test(origin));
}

export async function restoreSites() {
  // Rebuild the scripts after an extension reload or update.
  await Promise.all((await grantedSites()).map(registerSite));
}

export async function forgetSites() {
  const sites = await grantedSites();
  if (!sites.length) return;
  await chrome.scripting.unregisterContentScripts({ ids: sites }).catch(() => undefined);
  await chrome.permissions.remove({ origins: sites });
}

export function siteMatch({ protocol, hostname, port }: URL) {
  if (protocol !== "https:" && protocol !== "http:") return;
  if (hostname.includes("*")) return;
  // Chrome match patterns without a port also cover other ports on the host.
  return `${protocol}//${hostname}:${port || (protocol === "https:" ? 443 : 80)}/*`;
}

export async function activateSite(tab: chrome.tabs.Tab, setLens: (on?: boolean) => Promise<void>) {
  const { id: tabId, url } = tab;
  if (tabId === undefined || !url) return;
  const pageUrl = new URL(url);
  const match = siteMatch(pageUrl);
  if (!match) return;

  const { protocol, hostname, origin } = pageUrl;
  const host = `${protocol}//${hostname}`;
  const builtin = chrome.runtime.getManifest().content_scripts?.some(({ matches }) => matches?.includes(host + "/*"));
  if (!builtin) {
    const permission = { origins: [match] };
    const hadAccess = chrome.permissions.contains(permission);
    // Make the request in the action's gesture, before awaiting any Chrome API.
    if (!await chrome.permissions.request(permission)) return;
    await registerSite(match);
    if (await hadAccess) {
      const editing = await focusedEditor(tabId);
      if (editing === true) return;
      if (editing === false) return setLens();
    }
    const current = await chrome.tabs.get(tabId).catch(() => undefined);
    if (current?.url && new URL(current.url).origin === origin) {
      await setLens(true);
      await chrome.scripting.executeScript({ target: { tabId }, files: ["main.js"] });
    }
    return;
  }
  if (await focusedEditor(tabId) !== true) await setLens();
}

function focusedEditor(tabId: number): Promise<boolean | undefined> {
  return chrome.tabs.sendMessage(tabId, { type: "focused-editor" }, { frameId: 0 }).catch(() => undefined);
}
