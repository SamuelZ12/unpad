import { chatgptOrigins } from "../background/chatgpt";
import { providers, recognizeKey } from "../background/providers";
import { bridgeAddress, DEMO_ARTICLE, hostPermission, issue, type PublicEngine } from "../shared/connection";
import { assignedShortcut, SHORTCUT_SETTINGS } from "../shared/shortcut";

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const key = byId<HTMLInputElement>("key");
const about = byId<HTMLTextAreaElement>("about");
const model = byId<HTMLInputElement>("model");
const planModel = byId<HTMLSelectElement>("plan-model");
const bridge = byId<HTMLInputElement>("bridge");
const accounts = byId<HTMLSelectElement>("accounts");

const name = chrome.runtime.getManifest().name;
document.title = name;
byId("name").textContent = name;
byId<HTMLAnchorElement>("try-link").href = DEMO_ARTICLE;

let keyPath = false;
let busy = false;
let activeEngine: PublicEngine | undefined;
let accountShown = "";

function problem(message?: string) {
  byId("problem").textContent = message ?? "";
  byId("problem").hidden = !message;
}

function showPath() {
  byId("key-form").hidden = !keyPath || !!activeEngine;
  byId("choose").hidden = keyPath || !!activeEngine;
  if (keyPath) key.focus();
}

const send = (action: string, value?: string) => chrome.runtime.sendMessage({ type: "settings", action, value });

async function refresh(updateForm = true) {
  const [{ engine, about: savedAbout, account, accounts: savedAccounts = [], issue: error }, shortcut] = await Promise.all([
    chrome.runtime.sendMessage({ type: "connection" }),
    assignedShortcut(),
  ]);
  activeEngine = engine;
  const usingPlan = engine?.kind === "chatgpt";
  const needsSignIn = usingPlan && (error === issue.signedOut || error === issue.denied);
  const usageLimit = usingPlan && error === issue.usage;
  const selected = savedAccounts.find(({ clientId }: { clientId: string }) => clientId === account);
  byId("connect").hidden = false;
  byId("advanced").hidden = false;
  byId("try").hidden = !engine || usageLimit || needsSignIn;
  byId("personalize").hidden = !engine || engine.kind === "bridge";
  byId("connected").hidden = !engine;
  byId("usage-primary").hidden = !usageLimit;
  byId("usage").hidden = !usingPlan || usageLimit;
  byId("chatgpt").hidden = false;
  byId("key-path").hidden = needsSignIn;
  byId("model-form").hidden = !engine || engine.kind === "bridge";
  showPath();
  if (needsSignIn) byId("choose").hidden = false;
  byId("connection-name").textContent = usingPlan
    ? `Using ChatGPT plan${selected?.email ? ` · ${selected.email}` : ""}`
    : engine?.kind === "key" ? `Connected to ${providers[(engine as Extract<PublicEngine, { kind: "key" }>).provider].label}`
    : "Connected";
  const accountChoices = JSON.stringify(savedAccounts);
  if (accountChoices !== accountShown) {
    accountShown = accountChoices;
    accounts.replaceChildren(
      ...savedAccounts.map(({ clientId, email }: { clientId: string; email?: string }, index: number) =>
        new Option(email ? `${email} · Account ${index + 1}` : `ChatGPT account ${index + 1}`, clientId)),
      new Option("Use another ChatGPT account", ""),
    );
    accounts.value = account ?? savedAccounts[0]?.clientId ?? "";
  }
  accounts.hidden = !savedAccounts.length;
  if (updateForm || !model.value) model.value = engine?.kind !== "bridge" ? engine?.model ?? "" : "";
  if (updateForm || !bridge.value) bridge.value = engine?.kind === "bridge" ? engine.url : "";
  if (updateForm) about.value = savedAbout ?? "";
  byId("try-copy").textContent = shortcut
    ? `Press ${shortcut} on the article. Select a ··· marker to show the original text.`
    : "Open the extension on the article and turn on cuts. You can also assign a keyboard shortcut.";
  if (error || updateForm) problem(error);
}

async function perform(action: string, value?: string, origins?: string[]) {
  if (busy) return;
  busy = true;
  const controls = [...document.querySelectorAll<HTMLButtonElement>("button")];
  const enabled = controls.filter((button) => !button.disabled);
  enabled.forEach((button) => { button.disabled = true; });
  problem();
  try {
    if (origins && !await chrome.permissions.request({ origins })) {
      problem(issue.permission);
      return;
    }
    const result = await send(action, value);
    if (!result?.error && (action === "key" || action === "disconnect")) {
      keyPath = false;
      key.value = "";
    }
    if (action !== "chatgpt" || result?.error) await refresh(action !== "about");
    if (result?.error) problem(result.error);
    else if (action === "about") byId("saved").textContent = "Saved";
  } catch {
    problem(issue.failed);
  } finally {
    busy = false;
    enabled.forEach((button) => { button.disabled = false; });
    byId<HTMLButtonElement>("connect-key").disabled = !recognizeKey(key.value.trim());
  }
}

byId("usage-primary").onclick = () => { void chrome.runtime.sendMessage({ type: "manage-usage" }); };
byId("chatgpt").onclick = () => void perform("chatgpt", accounts.value, chatgptOrigins);
byId("key-path").onclick = () => { keyPath = true; showPath(); };
byId("back").onclick = () => { keyPath = false; key.value = ""; key.dispatchEvent(new Event("input")); showPath(); };
byId("disconnect").onclick = () => void perform("disconnect");
byId("shortcuts").onclick = () => void chrome.tabs.create({ url: SHORTCUT_SETTINGS });

key.oninput = () => {
  const value = key.value.trim();
  const id = recognizeKey(value);
  byId<HTMLButtonElement>("connect-key").disabled = !id;
  byId("recognized").textContent = id ? `Recognized ${providers[id].label}`
    : value ? "This key format wasn’t recognized."
    : "Supports Anthropic, OpenAI, Google Gemini, and OpenRouter.";
  const link = byId<HTMLAnchorElement>("get-key");
  link.href = id ? providers[id].keysUrl : "https://aistudio.google.com/apikey";
  link.textContent = id && id !== "gemini" ? `Manage ${providers[id].label} API keys` : "Get a free Gemini API key";
};
byId<HTMLFormElement>("key-form").onsubmit = (event) => {
  event.preventDefault();
  const value = key.value.trim();
  const id = recognizeKey(value);
  if (id) void perform("key", value, [hostPermission(providers[id].origin)]);
};
byId<HTMLFormElement>("bridge-form").onsubmit = (event) => {
  event.preventDefault();
  const url = bridgeAddress(bridge.value.trim());
  if (!url) problem("Enter the bridge address, including http:// or https://.");
  else void perform("bridge", url, [hostPermission(url)]);
};
byId<HTMLFormElement>("about-form").onsubmit = (event) => {
  event.preventDefault();
  void perform("about", about.value);
};
about.oninput = () => { byId("saved").textContent = ""; };
byId<HTMLFormElement>("model-form").onsubmit = (event) => {
  event.preventDefault();
  void perform("model", planModel.hidden ? model.value : planModel.value);
};
byId<HTMLDetailsElement>("advanced").ontoggle = async () => {
  model.hidden = false;
  planModel.hidden = true;
  if (!byId<HTMLDetailsElement>("advanced").open || activeEngine?.kind !== "chatgpt") return;
  const { models } = await send("models").catch(() => ({}));
  if (activeEngine?.kind !== "chatgpt" || !models?.length) return;
  planModel.replaceChildren(...models.map(({ slug, label }: { slug: string; label: string }) => new Option(label, slug)));
  if (![...planModel.options].some(({ value }) => value === model.value)) planModel.prepend(new Option(model.value, model.value));
  planModel.value = model.value;
  planModel.hidden = false;
  model.hidden = true;
};

chrome.storage.onChanged.addListener((changes) => {
  if (changes.engine || changes.selectionIssue) void refresh(false).catch(() => {});
});
window.addEventListener("focus", () => { void refresh(false).catch(() => {}); });
void refresh().catch(() => problem(issue.failed));
