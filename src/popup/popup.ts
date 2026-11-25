import { builtinSite, builtinSites, grantedSites, inspectDocument, siteMatch } from "../background/sites";
import { TOGGLE_COMMAND } from "../shared/config";
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
  if (!status) return "Use the switch to start Filler Cut here.";
  if (status.kind === "cut") {
    const counts: string[] = [];
    if (status.removed) {
      const verb = status.lensOn ? "Removed" : "Can remove";
      counts.push(`${verb} ${status.removed} sentence${status.removed === 1 ? "" : "s"}`);
    }
    if (status.marks) counts.push(`${status.marks} key point${status.marks === 1 ? "" : "s"}`);
    if (!status.lensOn) counts.unshift("Lens off");
    return counts.join(" · ");
  }
  const feedback = statusFeedback(status);
  if (status.kind === "failed") return `${feedback.title} · ${status.reason}`;
  return feedback.detail ? `${feedback.title}. ${feedback.detail}` : feedback.title;
}

async function refresh(id: number) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (id !== refreshId) return;
  tabId = tab?.id;
  const [current, added, { lensOn }] = await Promise.all([
    tabId === undefined ? undefined : inspectDocument(tabId),
    grantedSites(),
    chrome.storage.local.get("lensOn"),
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
  lens.setAttribute("aria-label", enabled ? "Filler Cut on enabled sites" : "Filler Cut on this page");
  lens.setAttribute("aria-checked", String(page?.mode ? page.lensOn : enabled && lensOn !== false));
  status.textContent = match ? describe(page, enabled) : "Filler Cut can't run on this page.";
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
  void chrome.tabs.create({ url: change.href }).catch(() => showError("Couldn't open shortcut settings."));
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
}).catch(() => showError("Couldn't read the shortcut.")).finally(reloadPopup);
