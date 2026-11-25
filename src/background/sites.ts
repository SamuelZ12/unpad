import { TOGGLE_COMMAND } from "../shared/config";
import { documentRoute, type PressTarget } from "../shared/page-snapshot";

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

export async function inspectDocument(tabId: number): Promise<PressTarget | undefined> {
  try {
    const [document] = await chrome.scripting.executeScript({ target: { tabId }, func: () => location.href });
    if (document?.documentId && document.result && siteMatch(new URL(document.result))) {
      return { tabId, documentId: document.documentId, url: document.result };
    }
  } catch {
    // Restricted browser pages cannot be inspected.
  }
}

function injectDocument({ tabId, documentId }: PressTarget, file: string) {
  return chrome.scripting.executeScript({ target: { tabId, documentIds: [documentId] }, files: [file] });
}

export async function activateDocument({ tabId, documentId, url }: PressTarget, setLens: SetLens, existingScript = false) {
  const mode = await siteEnabled(url) ? "site" : "page";
  const press = () => chrome.tabs.sendMessage(tabId, { type: "press", url, mode }, { documentId })
    .catch(() => undefined);
  let shouldToggle = await press();
  const injected = shouldToggle === undefined && !existingScript;
  if (injected) {
    await injectDocument({ tabId, documentId, url }, mode === "site" ? "main.js" : "page.js");
    shouldToggle = await press();
    if (shouldToggle === undefined) throw new Error("The page did not receive the press");
  }
  // A press that had to start the script asks for cuts, whatever the shared lens was.
  if (shouldToggle === true && await siteEnabled(url)) await setLens(injected || undefined);
}

export async function addSites(matches: string[], setLens: SetLens) {
  if (!matches.length) return;
  const grants = await grantedSites();
  const enabled = matches.filter((match) => grants.includes(match));
  if (!enabled.length) return;
  await Promise.all(enabled.map(registerSite));
  await setLens(true);
  const tabs = await chrome.tabs.query({ url: enabled });
  for (const { id, url } of tabs) {
    if (id === undefined || !url) continue;
    void inspectDocument(id).then(async (target) => {
      if (target && documentRoute(target.url) === documentRoute(url) && await siteEnabled(target.url)) {
        await injectDocument(target, "main.js");
      }
    }).catch(console.warn);
  }
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
