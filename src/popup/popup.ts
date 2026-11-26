import { builtinSite, builtinSites, grantedSites, inspectDocument, siteMatch } from "../background/sites";
import { issue } from "../shared/connection";
import { assignedShortcut } from "../shared/shortcut";
import type { PageSnapshot, PressTarget } from "../shared/page-snapshot";
import { statusFeedback } from "../shared/status-copy";

const lens = document.querySelector<HTMLButtonElement>("#lens")!;
const status = document.querySelector("#status")!;
const error = document.querySelector<HTMLElement>("#error")!;
const setting = document.querySelector<HTMLElement>("#site-setting")!;
const siteLabel = document.querySelector("#site-label")!;
const siteBuiltin = document.querySelector<HTMLElement>("#site-builtin")!;
const always = document.querySelector<HTMLInputElement>("#always")!;
const sites = document.querySelector("#sites")!;
const shortcut = document.querySelector<HTMLElement>("#shortcut")!;
const change = document.querySelector<HTMLAnchorElement>("#change")!;

const connect = document.querySelector<HTMLButtonElement>("#connect-action")!;
const manage = document.querySelector<HTMLAnchorElement>("#manage")!;
const enabledSites = document.querySelector<HTMLElement>("#enabled-sites")!;
const settingsLink = document.querySelector<HTMLButtonElement>("#settings-link")!;
const name = chrome.runtime.getManifest().name;
document.title = name;
document.querySelector("#name")!.textContent = name;
manage.onclick = () => { void chrome.runtime.sendMessage({ type: "manage-usage" }); };
connect.onclick = settingsLink.onclick = () => void chrome.runtime.openOptionsPage();

let tabId: number | undefined;
let target: PressTarget | undefined;
let match: string | undefined;
let refreshId = 0;
let shortcutLabel = "";
let renderedSites = "";

function showError(message: string) {
  error.textContent = message;
  error.hidden = !message;
}

function describe(page: PageSnapshot | undefined, enabled: boolean) {
  const status = page?.status;
  if (!status && !enabled) {
    const controls = shortcutLabel ? `the switch or ${shortcutLabel}` : "the switch";
    return `Off on this site. Use ${controls} to cut this page once.`;
  }
  if (!status) return `Use the switch to start ${name} here.`;
  if (status.kind === "cut") {
    const counts: string[] = [];
    if (status.removed) {
      const verb = status.lensOn ? "Removed" : "Can remove";
      counts.push(`${verb} ${status.removed} sentence${status.removed === 1 ? "" : "s"}`);
    }
    if (status.marks) counts.push(`${status.marks} key point${status.marks === 1 ? "" : "s"}`);
    if (!status.lensOn) counts.unshift("Cuts off");
    return counts.join(" · ") || "All removed sentences are expanded.";
  }
  const feedback = statusFeedback(status);
  if (status.kind === "failed" && status.reason === issue.usage) return feedback.title;
  return feedback.detail ? `${feedback.title}. ${feedback.detail}` : feedback.title;
}

async function refresh(id: number) {
  const [[tab], connection] = await Promise.all([
    chrome.tabs.query({ active: true, currentWindow: true }),
    chrome.runtime.sendMessage({ type: "connection" }),
  ]);
  if (id !== refreshId) return;
  tabId = tab?.id;
  const connected = !!connection?.engine;
  const usage = connected && connection.issue === issue.usage;
  const signedOut = connected && (connection.issue === issue.signedOut || connection.issue === issue.denied);
  connect.hidden = connected && !signedOut;
  connect.textContent = signedOut ? "Sign in again" : "Set up";
  manage.hidden = !usage;
  settingsLink.hidden = !connected;
  enabledSites.hidden = change.hidden = !connected || usage || signedOut;
  shortcut.hidden = change.hidden || !shortcutLabel;
  if (!connected || usage || signedOut) {
    lens.hidden = setting.hidden = true;
    status.textContent = connected ? connection.issue : "Connect to start cutting pages.";
    return;
  }
  const [current, added] = await Promise.all([
    tabId === undefined ? undefined : inspectDocument(tabId),
    grantedSites(),
  ]);
  const page: PageSnapshot | undefined = current && await chrome.tabs.sendMessage(
    current.tabId, { type: "page-status" }, { documentId: current.documentId },
  ).catch(() => undefined);
  if (id !== refreshId) return;

  target = current;
  const url = current && new URL(current.url);
  match = url && siteMatch(url);
  const builtIn = !!url && builtinSite(url);
  const enabled = builtIn || (match !== undefined && added.includes(match));
  lens.hidden = setting.hidden = !match;
  lens.setAttribute("aria-label", enabled ? "Cuts on enabled sites" : "Cuts on this page");
  lens.setAttribute("aria-checked", String(!!page?.mode && page.lensOn));
  status.textContent = match ? describe(page, enabled) : `${name} can’t run on this page.`;
  siteLabel.textContent = url ? `Always run on ${url.host}` : "";
  siteBuiltin.hidden = !builtIn;
  always.checked = enabled;
  always.disabled = builtIn;
  renderSites(added);
}

function renderSites(added: string[]) {
  const builtIn = builtinSites();
  const list = [...builtIn, ...added.sort()];
  const signature = JSON.stringify(list);
  if (signature === renderedSites) return;
  renderedSites = signature;
  const urls = list.map((pattern) => new URL(pattern));
  sites.replaceChildren(...urls.map((url, index) => {
    const host = urls.some((other) => other !== url && other.host === url.host) ? url.origin : url.host;
    const pattern = list[index];
    const row = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = host;
    row.append(label);
    if (builtIn.includes(pattern)) {
      const tag = document.createElement("span");
      tag.className = "muted";
      tag.textContent = "built in";
      row.append(tag);
    } else {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "remove";
      button.textContent = "Remove";
      button.setAttribute("aria-label", `Remove ${host}`);
      button.addEventListener("click", () => void removeSite(pattern));
      row.append(button);
    }
    return row;
  }));
}

function reloadPopup() {
  const id = ++refreshId;
  void refresh(id).catch(() => {
    if (id === refreshId) status.textContent = "Couldn't read this tab.";
  });
}

async function removeSite(match: string) {
  showError("");
  const removed = await chrome.runtime.sendMessage({ type: "remove-site", match }).catch(() => false);
  if (!removed) showError("Couldn't remove this site.");
  reloadPopup();
}

lens.addEventListener("click", async () => {
  if (!target) return;
  showError("");
  lens.disabled = true;
  const pressed = await chrome.runtime.sendMessage({ type: "popup-press", ...target }).catch(() => false);
  if (!pressed) showError(`Couldn’t run ${name} on this page.`);
  lens.disabled = false;
  reloadPopup();
});

always.addEventListener("change", async () => {
  if (!match) return;
  if (!always.checked) {
    await removeSite(match);
    return;
  }
  showError("");
  // The permission prompt can close the popup, so onAdded in the worker does the setup.
  try {
    await chrome.permissions.request({ origins: [match] });
  } catch {
    showError("Couldn't request access to this site.");
  }
  reloadPopup();
});

change.addEventListener("click", (event) => {
  event.preventDefault();
  void chrome.tabs.create({ url: change.href }).catch(() => showError("Couldn't open shortcut settings."));
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "page-status-changed" && sender.tab?.id === tabId) reloadPopup();
});
chrome.tabs.onUpdated.addListener((id, change) => {
  if (id === tabId && (change.url || change.status === "complete")) reloadPopup();
});
chrome.storage.onChanged.addListener((changes) => {
  if (changes.engine || changes.selectionIssue) reloadPopup();
});
chrome.permissions.onAdded.addListener(reloadPopup);
chrome.permissions.onRemoved.addListener(reloadPopup);

void assignedShortcut().then((key) => {
  if (!key) return;
  shortcutLabel = key;
  shortcut.textContent = key;
  change.textContent = "Change";
  change.setAttribute("aria-label", "Change shortcut");
}).catch(() => showError("Couldn't read the shortcut.")).finally(reloadPopup);
