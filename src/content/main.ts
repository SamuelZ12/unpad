import { candidates, fadedIds, reduce, view, type PageEvent, type PageState } from "../core/state";
import type { Doc } from "../shared/types";
import { parseErrorResponse, parseSelectResponse } from "../shared/wire";
import { extract, type AnchoredDoc } from "./anchor";
import { fadedAtPoint, listenForRestore } from "./click";
import { createLog } from "./log";
import { listenForHold } from "./hold";
import { listenForToggle } from "./keys";
import { observePage } from "./observe";
import { createPainter } from "./paint";

const paint = createPainter();
let href = location.href;
let log = createLog(href);
let pageView = 0;
let scanVersion = 0;
const shown = new Set<Doc["key"]>();

let state: PageState = { lensOn: false, holding: false, docs: new Map() };
let anchoredDocs: AnchoredDoc[] = [];
let lastBadge: string | undefined;

function currentView() {
  if (anchoredDocs.length === state.docs.size) return view(state);
  const visible = new Set(anchoredDocs.map(({ doc }) => doc.key));
  return view({ ...state, docs: new Map([...state.docs].filter(([key]) => visible.has(key))) });
}

function render(animate = true) {
  paint(anchoredDocs, state, animate);
  const html = document.documentElement;
  const current = currentView();
  html.dataset.fillerCutState = current;
  let fadedTotal = 0;
  let readyTotal = 0;
  let failed = false;
  for (const { doc } of anchoredDocs) {
    const faded = fadedIds(state, doc.key).length;
    fadedTotal += faded;
    const entry = state.docs.get(doc.key);
    const picks = entry?.picks;
    if (entry && current === "picks-ready") readyTotal += candidates(entry).length;
    failed ||= picks?.kind === "failed";
    if (!faded || picks?.kind !== "ready" || shown.has(doc.key)) continue;
    shown.add(doc.key);
    void log({
      type: "shown", cacheKey: picks.cacheKey,
      total: doc.sentences.length, faded,
    }).catch(console.warn);
  }
  html.dataset.fillerCutFaded = String(fadedTotal);
  let badge = "";
  if (current === "waiting") badge = "…";
  else if (current === "faded") badge = String(fadedTotal);
  else if (current === "picks-ready") badge = String(readyTotal);
  else if (failed) badge = "!";
  if (badge !== lastBadge) {
    lastBadge = badge;
    void chrome.runtime.sendMessage({ type: "badge", text: badge }).catch(console.warn);
  }
}

function dispatch(event: PageEvent) {
  state = reduce(state, event);
  render(event.type !== "restore" && event.type !== "navigated");
}

async function requestPicks(doc: Doc, requestedOn: number) {
  const isCurrent = () => requestedOn === pageView && href === location.href;
  try {
    const answer: unknown = await chrome.runtime.sendMessage({ type: "select", doc });
    const picks = parseSelectResponse(answer);
    if (!picks) throw new Error(parseErrorResponse(answer)?.error ?? "Invalid selection response");
    if (isCurrent()) dispatch({ type: "picks-arrived", docKey: doc.key, ...picks });
  } catch (error) {
    if (isCurrent()) dispatch({ type: "picks-failed", docKey: doc.key, reason: String(error) });
  }
}

async function scan() {
  const start = performance.now();
  const version = ++scanVersion;
  const docs = await extract(document, new URL(href));
  if (version !== scanVersion || href !== location.href) return;

  const previous = anchoredDocs;
  anchoredDocs = docs.filter(({ root }) => root.isConnected);
  const rebuilt = anchoredDocs.some(({ root, doc }) =>
    state.docs.has(doc.key) && !previous.some((prior) => prior.root === root));

  if (process.env.FILLER_CUT_DEV === "1") {
    document.documentElement.dataset.fillerCutDebug = JSON.stringify({
      docs: anchoredDocs.map(({ doc }) => doc),
      extractMs: performance.now() - start,
    });
  }
  for (const { doc } of anchoredDocs) {
    if (state.docs.has(doc.key)) continue;
    dispatch({ type: "doc-found", doc });
    void requestPicks(doc, pageView);
  }
  render(!rebuilt && anchoredDocs.length > 0);
}

function navigate() {
  href = location.href;
  pageView++;
  anchoredDocs = [];
  shown.clear();
  log = createLog(href);
  dispatch({ type: "navigated" });
  void scan();
}

let lensChanges = 0;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.lensOn) return;
  lensChanges++;
  dispatch({ type: "lens-set", on: changes.lensOn.newValue !== false });
});

listenForToggle(() => {
  void chrome.runtime.sendMessage({ type: "toggle" }).catch(console.warn);
});

listenForHold(
  () => dispatch({ type: "hold-start" }),
  (heldMs) => {
    const revealed = currentView() === "revealed";
    dispatch({ type: "hold-end" });
    if (revealed) void log({ type: "reveal", heldMs }).catch(console.warn);
  },
);

listenForRestore((x, y) => {
  const target = fadedAtPoint(document, x, y, anchoredDocs, state);
  if (!target) return;
  const entry = state.docs.get(target.docKey);
  if (entry?.picks.kind !== "ready") return;
  dispatch({ type: "restore", ...target });
  void log({
    type: "restore", cacheKey: entry.picks.cacheKey, sentenceId: target.id,
    text: entry.doc.sentences[target.id - 1],
  }).catch(console.warn);
});

void chrome.storage.local.get("lensOn").then(({ lensOn }) => {
  if (!lensChanges) dispatch({ type: "lens-set", on: lensOn !== false });
  observePage(() => void scan(), navigate);
  return scan();
});
