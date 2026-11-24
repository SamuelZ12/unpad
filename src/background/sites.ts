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
  // Only exact scheme, host, and port grants enable generic extraction.
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

function builtinSite(url: URL) {
  const pattern = `${url.protocol}//${url.hostname}/*`;
  return chrome.runtime.getManifest().content_scripts?.some(({ matches }) => matches?.includes(pattern)) ?? false;
}

export async function siteEnabled(url: string | undefined) {
  const pageUrl = url && URL.parse(url);
  if (!pageUrl) return false;
  const match = siteMatch(pageUrl);
  return !!match && (builtinSite(pageUrl) || (await grantedSites()).includes(match));
}

type SetLens = (on?: boolean) => Promise<void>;

async function inspectDocument(tabId: number) {
  const [document] = await chrome.scripting.executeScript({ target: { tabId }, func: () => location.href });
  return document;
}

async function injectDocument(tabId: number, url: string, file: string) {
  // Bind injection to the document inspected by the action, even if the tab navigates.
  const document = await inspectDocument(tabId);
  if (document?.documentId && document.result === url) {
    await chrome.scripting.executeScript({ target: { tabId, documentIds: [document.documentId] }, files: [file] });
  }
}

export async function activateDocument({ id: tabId, url }: chrome.tabs.Tab, setLens: SetLens) {
  if (tabId === undefined || !url || !siteMatch(new URL(url))) return;
  if (!await siteEnabled(url)) return injectDocument(tabId, url, "page.js");
  const status = await chrome.tabs.sendMessage(tabId, { type: "editor-status" }, { frameId: 0 })
    .catch(() => undefined) as { editing: boolean; site: boolean } | undefined;
  if (status?.editing) return;
  await setLens();
  if (!status?.site) await injectDocument(tabId, url, "main.js");
}

export async function setSite({ id: tabId, url }: chrome.tabs.Tab, checked: boolean, setLens: SetLens) {
  if (tabId === undefined || !url) return;
  const pageUrl = new URL(url);
  const match = siteMatch(pageUrl);
  if (!match || builtinSite(pageUrl)) return;
  const permission = { origins: [match] };
  if (checked) {
    // Request access in the menu click's gesture, before awaiting any Chrome API.
    if (!await chrome.permissions.request(permission)) return;
    await registerSite(match);
    await setLens(true);
    await injectDocument(tabId, pageUrl.href, "main.js");
  } else {
    const filter = { ids: [match] };
    if ((await chrome.scripting.getRegisteredContentScripts(filter)).length) {
      await chrome.scripting.unregisterContentScripts(filter);
    }
    const tabs = await chrome.tabs.query({});
    await chrome.permissions.remove(permission);
    await Promise.all(tabs.filter(({ url }) => !url || new URL(url).origin === pageUrl.origin)
      .map(({ id }) => id === undefined ? undefined :
        chrome.tabs.sendMessage(id, { type: "site-removed", origin: pageUrl.origin }, { frameId: 0 }).catch(() => {})));
  }
}

export const siteMenuId = "always-run";
let menuUpdate = 0;

export async function syncSiteMenu() {
  const update = ++menuUpdate;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  // Content-script matches can provide access to the document without exposing Tab.url.
  const tabId = tab?.id;
  let url = tab?.url;
  if (!url && tabId !== undefined) {
    url = await chrome.tabs.sendMessage(tabId, { type: "site-url" }, { frameId: 0 }).catch(() => undefined);
    if (!url && (await grantedSites()).length) {
      url = (await inspectDocument(tabId).catch(() => undefined))?.result;
    }
  }
  const pageUrl = url && URL.parse(url);
  const builtin = !!pageUrl && builtinSite(pageUrl);
  const checked = builtin || await siteEnabled(url);
  if (update === menuUpdate) await chrome.contextMenus.update(siteMenuId, { checked, enabled: !builtin });
}
