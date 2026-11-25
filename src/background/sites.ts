import { TOGGLE_COMMAND } from "../shared/config";

export async function ownsShortcut() {
  return (await chrome.commands.getAll()).some(({ name, shortcut }) => name === TOGGLE_COMMAND && !!shortcut);
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

export function optionalSiteMatches(origins: string[] = []) {
  return origins.filter((origin) => /^https?:\/\/(?:\[[^\]]+\]|[^*:]+):\d+\/\*$/.test(origin));
}

export async function grantedSites() {
  const { origins } = await chrome.permissions.getAll();
  return optionalSiteMatches(origins);
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

export function siteMatch({ protocol, hostname, port, pathname }: URL) {
  if (protocol !== "https:" && protocol !== "http:") return;
  if (hostname === "chromewebstore.google.com" ||
    (hostname === "chrome.google.com" && pathname.startsWith("/webstore"))) return;
  if (hostname.includes("*")) return;
  // Chrome match patterns without a port also cover other ports on the host.
  return `${protocol}//${hostname}:${port || (protocol === "https:" ? 443 : 80)}/*`;
}

export function builtinSites() {
  return chrome.runtime.getManifest().content_scripts?.flatMap(({ matches }) => matches ?? []) ?? [];
}

export function builtinSite(url: URL) {
  return builtinSites().includes(`${url.protocol}//${url.hostname}/*`);
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

export async function documentUrl(tabId: number) {
  return (await inspectDocument(tabId).catch(() => undefined))?.result;
}

async function injectDocument(tabId: number, url: string, file: string) {
  // Bind injection to the document inspected by the action, even if the tab navigates.
  const document = await inspectDocument(tabId);
  // Chrome keeps a #:~:text= directive in the tab URL and hides it from the page.
  const route = (href: string) => href.split("#", 1)[0];
  if (document?.documentId && document.result !== undefined && route(document.result) === route(url)) {
    await chrome.scripting.executeScript({ target: { tabId, documentIds: [document.documentId] }, files: [file] });
  }
}

export async function activateDocument(tab: Pick<chrome.tabs.Tab, "id" | "url">, setLens: SetLens) {
  const tabId = tab.id;
  if (tabId === undefined) return;
  const url = tab.url ?? await documentUrl(tabId);
  if (!url || !siteMatch(new URL(url))) return;
  if (!await siteEnabled(url)) return injectDocument(tabId, url, "page.js");
  const press = () => chrome.tabs.sendMessage(tabId, { type: "site-press", url }, { frameId: 0 })
    .catch(() => undefined);
  let shouldToggle = await press();
  if (shouldToggle === undefined) {
    await injectDocument(tabId, url, "main.js");
    shouldToggle = await press();
  }
  if (shouldToggle === true) await setLens();
}

export async function addSites(matches: string[], setLens: SetLens) {
  if (!matches.length) return;
  const grants = await grantedSites();
  const enabled = matches.filter((match) => grants.includes(match));
  if (!enabled.length) return;
  await Promise.all(enabled.map(registerSite));
  await setLens(true);
  const tabs = await chrome.tabs.query({ url: enabled });
  await Promise.allSettled(tabs.flatMap(({ id, url }) => id !== undefined && url && enabled.includes(siteMatch(new URL(url)) ?? "")
    ? [injectDocument(id, url, "main.js")] : []));
}

export async function deactivateSites(matches: string[]) {
  if (!matches.length) return;
  const granted = await grantedSites();
  const revoked = matches.filter((match) => !granted.includes(match));
  if (!revoked.length) return;
  const ids = (await chrome.scripting.getRegisteredContentScripts({ ids: revoked })).map(({ id }) => id);
  if (ids.length) await chrome.scripting.unregisterContentScripts({ ids });

  const origins = new Set(revoked.map((match) => new URL(match).origin));
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.flatMap(({ id, url }) => id !== undefined && (!url || origins.has(new URL(url).origin))
    ? [...origins].map((origin) =>
      chrome.tabs.sendMessage(id, { type: "site-removed", origin }, { frameId: 0 }).catch(() => {})) : []));
}
