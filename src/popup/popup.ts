import { builtinSite, builtinSites, documentUrl, grantedSites, siteMatch } from "../background/sites";
import { TOGGLE_COMMAND } from "../shared/config";
import type { PageSnapshot } from "../shared/page-snapshot";
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

let tabId: number | undefined;
let tabUrl: string | undefined;
let match: string | undefined;
let refreshId = 0;
let shortcutLabel = "";

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
  if (!status) return "Reading…";
  if (status.kind === "cut") {
    const counts = [
      status.removed ? `${status.lensOn ? "Removed" : "Can remove"} ${status.removed} sentence${status.removed === 1 ? "" : "s"}` : "",
      status.marks ? `${status.marks} key point${status.marks === 1 ? "" : "s"}` : "",
    ].filter(Boolean).join(" · ");
    return status.lensOn ? counts : `Lens off · ${counts}`;
  }
  const feedback = statusFeedback(status);
  if (!feedback) return "";
  return feedback.detail ? `${feedback.title}. ${feedback.detail}` : feedback.title;
}

async function refresh() {
  const id = ++refreshId;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const [added, page, { lensOn }] = await Promise.all([
    grantedSites(),
    tab?.id === undefined ? undefined : chrome.tabs.sendMessage(tab.id, { type: "page-status" }, { frameId: 0 })
      .catch(() => undefined) as Promise<PageSnapshot | undefined>,
    chrome.storage.local.get("lensOn"),
  ]);
  const href = tab?.url ?? page?.url ?? (tab?.id === undefined ? undefined : await documentUrl(tab.id));
  if (id !== refreshId) return;

  tabId = tab?.id;
  tabUrl = href;
  const url = tabUrl && URL.parse(tabUrl);
  const currentMatch = url ? siteMatch(url) : undefined;
  const builtIn = !!url && builtinSite(url);
  const enabled = builtIn || (currentMatch !== undefined && added.includes(currentMatch));
  match = currentMatch;
  lens.hidden = setting.hidden = !currentMatch;
  lens.setAttribute("aria-checked", String(page?.mode ? page.lensOn : enabled && lensOn !== false));
  status.textContent = currentMatch ? describe(page, enabled) : "Filler Cut can't run on this page.";
  siteLabel.textContent = url ? `Always run on ${url.host}` : "";
  siteBuiltin.hidden = !builtIn;
  always.checked = enabled;
  always.disabled = builtIn;
  renderSites(added);
}

function renderSites(added: string[]) {
  const builtIn = builtinSites();
  const list = [...builtIn, ...added.sort()];
  sites.replaceChildren(...list.map((pattern) => {
    const host = new URL(pattern).host;
    const row = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = host;
    row.append(label);
    if (!builtIn.includes(pattern)) {
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
  void refresh().catch(() => showError("Couldn't read this tab."));
}

async function removeSite(match: string) {
  showError("");
  const removed = await chrome.runtime.sendMessage({ type: "remove-site", match }).catch(() => false);
  if (!removed) showError("Couldn't remove this site.");
  reloadPopup();
}

lens.addEventListener("click", async () => {
  if (tabId === undefined || !tabUrl) return;
  showError("");
  lens.disabled = true;
  const pressed = await chrome.runtime.sendMessage({ type: "popup-press", tabId, url: tabUrl }).catch(() => false);
  if (!pressed) showError("Couldn't run Filler Cut on this page.");
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
  void chrome.tabs.create({ url: change.href });
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "page-status-changed" && sender.tab?.id === tabId) reloadPopup();
});
chrome.tabs.onUpdated.addListener((id, change) => {
  if (id === tabId && (change.url || change.status === "complete")) reloadPopup();
});
chrome.permissions.onAdded.addListener(reloadPopup);
chrome.permissions.onRemoved.addListener(reloadPopup);

void chrome.commands.getAll().then((commands) => {
  const key = commands.find(({ name }) => name === TOGGLE_COMMAND)?.shortcut;
  if (key) {
    const mac = navigator.platform.startsWith("Mac");
    const symbols: Record<string, string> = { Alt: "⌥", MacCtrl: "⌃", Ctrl: "⌃", Shift: "⇧", Command: "⌘", Meta: "⌘" };
    shortcutLabel = mac ? key.split("+").map((part) => symbols[part] ?? part).join("") : key;
    shortcut.textContent = shortcutLabel;
    shortcut.hidden = false;
    change.textContent = "Change";
    change.setAttribute("aria-label", "Change shortcut");
  }
}).finally(reloadPopup);
