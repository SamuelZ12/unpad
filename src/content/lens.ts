import { candidates, fadedIds, markedIds, reduce, view, type PageEvent, type PageState } from "../core/state";
import type { Doc } from "../shared/types";
import { parseErrorResponse, parseSelectResponse, type SelectRequest } from "../shared/wire";
import { extract, type AnchoredDoc } from "./anchor";
import { paintedAtPoint, listenForPaintClick } from "./click";
import { createLog } from "./log";
import { listenForHold } from "./hold";
import { hasFocusedEditor, listenForToggle } from "./keys";
import { observePage } from "./observe";
import { createPainter } from "./paint";
import { usesGenericSurface } from "./surfaces";

type Mode = "site" | "page";

function start() {
  const paint = createPainter();
  let href = location.href;
  let log = createLog(href);
  let pageView = 0;
  let scanVersion = 0;
  let mode: Mode | undefined;
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
    let markedTotal = 0;
    let readyTotal = 0;
    let failed = false;
    for (const { doc } of anchoredDocs) {
      const faded = fadedIds(state, doc.key).length;
      const marks = markedIds(state, doc.key).length;
      fadedTotal += faded;
      markedTotal += marks;
      const entry = state.docs.get(doc.key);
      const picks = entry?.picks;
      if (entry && current === "picks-ready") readyTotal += candidates(entry).length;
      failed ||= picks?.kind === "failed";
      if ((!faded && !marks) || picks?.kind !== "ready" || shown.has(doc.key)) continue;
      shown.add(doc.key);
      void log({
        type: "shown", cacheKey: picks.cacheKey,
        total: doc.sentences.length, faded, marks,
      }).catch(console.warn);
    }
    html.dataset.fillerCutFaded = String(fadedTotal);
    html.dataset.fillerCutMarked = String(markedTotal);
    let badge = "";
    if (current === "waiting") badge = "…";
    else if (current === "faded" && fadedTotal) badge = String(fadedTotal);
    else if (current === "picks-ready" && readyTotal) badge = String(readyTotal);
    else if (failed) badge = "!";
    if (mode === "page" && !state.lensOn) badge = "";
    if (badge !== lastBadge) {
      lastBadge = badge;
      void chrome.runtime.sendMessage({ type: "badge", text: badge }).catch(console.warn);
    }
  }

  function dispatch(event: PageEvent) {
    state = reduce(state, event);
    render(event.type !== "restore" && event.type !== "unmark" && event.type !== "navigated");
  }

  async function requestPicks(doc: Doc, check: SelectRequest["check"], requestedOn: number) {
    const isCurrent = () => requestedOn === pageView && href === location.href;
    try {
      const answer: unknown = await chrome.runtime.sendMessage({ type: "select", doc: { ...doc, check, key: true } });
      const picks = parseSelectResponse(answer);
      if (!picks) throw new Error(parseErrorResponse(answer)?.error ?? "Invalid selection response");
      if (isCurrent()) dispatch({ type: "picks-arrived", docKey: doc.key, ...picks });
    } catch (error) {
      if (isCurrent()) dispatch({ type: "picks-failed", docKey: doc.key, reason: String(error) });
    }
  }

  async function scan() {
    if (!mode || (mode === "page" && !state.lensOn)) return;
    const start = performance.now();
    const version = ++scanVersion;
    const url = new URL(href);
    const check = mode === "site" && usesGenericSurface(url) ? { url: url.origin + url.pathname } : undefined;
    const docs = await extract(document, url, !!check);
    if (version !== scanVersion || href !== location.href || (mode === "page" && !state.lensOn)) return;

    const previous = anchoredDocs;
    anchoredDocs = docs.filter(({ root }) => root.isConnected);
    // X can replace every node in the article when the reader scrolls back.
    // The same DocKey keeps its picks and restores while the ranges are rebuilt.
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
      void requestPicks(doc, check, pageView);
    }
    render(!rebuilt && anchoredDocs.length > 0);
  }

  function reset() {
    href = location.href;
    pageView++;
    scanVersion++;
    anchoredDocs = [];
    shown.clear();
    log = createLog(href);
    dispatch({ type: "navigated" });
  }

  function stop() {
    mode = undefined;
    state = { ...state, lensOn: false };
    reset();
  }

  function navigate() {
    if (href === location.href) return;
    if (mode === "page") {
      // A section link stays in this page. A new route, hash routes included, needs its own action.
      const anchor = location.hash.slice(1);
      const sameDocument = href.split("#", 1)[0] === location.href.split("#", 1)[0] &&
        (!anchor || !!document.getElementById(anchor) || document.getElementsByName(anchor).length > 0);
      if (sameDocument) href = location.href;
      else stop();
    } else if (mode === "site") reset();
    void scan();
  }

  let lensChanges = 0;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (mode !== "site" || area !== "local" || !changes.lensOn) return;
    lensChanges++;
    dispatch({ type: "lens-set", on: changes.lensOn.newValue !== false });
  });

  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message?.type === "editor-status") reply({ editing: hasFocusedEditor(), site: mode === "site" });
    if (message?.type === "site-url" && mode === "site") reply(location.href);
    if (message?.type === "site-removed" && mode === "site" && message.origin === location.origin) {
      stop();
      reply(true);
    }
  });

  listenForToggle(() => {
    const currentMode = mode;
    const requestedOn = pageView;
    if (!currentMode) return false;
    void chrome.runtime.sendMessage({ type: "toggle", mode: currentMode }).then((allowed) => {
      if (allowed && mode === "page" && currentMode === "page" && pageView === requestedOn && href === location.href) {
        togglePage();
      }
    }).catch(console.warn);
  });

  listenForHold(
    () => dispatch({ type: "hold-start" }),
    (heldMs) => {
      const revealed = currentView() === "revealed";
      dispatch({ type: "hold-end" });
      if (revealed) void log({ type: "reveal", heldMs }).catch(console.warn);
    },
  );

  listenForPaintClick((x, y) => {
    const target = paintedAtPoint(document, x, y, anchoredDocs, state);
    if (!target) return;
    const entry = state.docs.get(target.docKey);
    if (entry?.picks.kind !== "ready") return;
    dispatch(target);
    void log({
      type: target.type, cacheKey: entry.picks.cacheKey, sentenceId: target.id,
      text: entry.doc.sentences[target.id - 1],
    }).catch(console.warn);
  });

  function togglePage() {
    if (hasFocusedEditor()) return;
    dispatch({ type: "lens-set", on: !state.lensOn });
    if (state.lensOn) void scan();
  }

  observePage(() => void scan(), navigate);
  window.addEventListener("pagehide", () => {
    if (mode === "page") stop();
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted && mode === "site") {
      void chrome.runtime.sendMessage({ type: "site-enabled" }).then((enabled) => {
        if (mode === "site" && !enabled) stop();
      }).catch(console.warn);
    }
  });

  return (next: Mode) => {
    navigate();
    if (next === "page") {
      if (mode === "site") return;
      mode = "page";
      // Events from this press belong to the route it was pressed on.
      if (href !== location.href) reset();
      togglePage();
    } else if (mode !== "site") {
      mode = "site";
      reset();
      const changes = ++lensChanges;
      void chrome.storage.local.get("lensOn").then(({ lensOn }) => {
        if (mode !== "site") return;
        if (changes === lensChanges) dispatch({ type: "lens-set", on: lensOn !== false });
        return scan();
      });
    }
  };
}

// Registration and immediate injection can meet in the same document.
const page = globalThis as typeof globalThis & { fillerCutRun?: ReturnType<typeof start> };
export function run(mode: Mode) {
  if (mode === "page" && hasFocusedEditor()) return;
  (page.fillerCutRun ??= start())(mode);
}
