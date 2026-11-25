import { pageStatus, type NoContentHint, type PageStatus } from "../core/page-status";
import { fadedIds, markedIds, reduce, view, type PageEvent, type PageState } from "../core/state";
import type { Doc, DocKey, SentenceId } from "../shared/types";
import { parseErrorResponse, parseSelectResponse, type SelectRequest } from "../shared/wire";
import { documentRoute, type PageSnapshot } from "../shared/page-snapshot";
import { statusFeedback } from "../shared/status-copy";
import { MIN_MARK_SENTENCES } from "../shared/config";
import { extract, type AnchoredDoc } from "./anchor";
import { listenForMarkClick } from "./click";
import { createLog } from "./log";
import { listenForHold } from "./hold";
import { hasFocusedEditor, listenForToggle } from "./keys";
import { observePage } from "./observe";
import { createProjection } from "./reconcile";
import { createToast } from "./toast";
import { usesGenericSurface } from "./surfaces";

type Mode = "site" | "page";

function start() {
  const projection = createProjection((docKey, ids, pin) => {
    dispatch({ type: "restore", docKey, ids }, pin);
  });
  let href = location.href;
  let log = createLog(href);
  let pageView = 0;
  let scanVersion = 0;
  let mode: Mode | undefined;
  const shown = new Set<Doc["key"]>();

  let state: PageState = { lensOn: false, holding: false, docs: new Map() };
  let anchoredDocs: AnchoredDoc[] = [];
  let hint: NoContentHint | undefined;
  let scanError: string | undefined;
  let lastAttempt: PageStatus | undefined;
  let scanning: Promise<void> | undefined;
  let pendingFeedback: Mode | undefined;
  let lastStatus: string | undefined;
  const toast = createToast((change) => mutate(change));

  function visibleState() {
    return {
      ...state,
      docs: new Map(anchoredDocs.flatMap(({ doc }) => {
        const entry = state.docs.get(doc.key);
        return entry ? [[doc.key, entry]] : [];
      })),
    };
  }

  function currentStatus(): PageStatus {
    return scanError ? { kind: "failed", reason: scanError } : pageStatus(visibleState(), hint);
  }

  function snapshot(): PageSnapshot {
    return { mode, lensOn: state.lensOn, status: mode ? currentStatus() : lastAttempt };
  }

  type Pin = Parameters<typeof projection.reconcile>[2];

  function render(pin?: Pin) {
    mutate(() => projection.reconcile(anchoredDocs, state, pin));
    const html = document.documentElement;
    const current = view(visibleState());
    html.dataset.fillerCutState = current;
    let fadedTotal = 0;
    let markedTotal = 0;
    for (const { doc } of anchoredDocs) {
      const faded = fadedIds(state, doc.key).length;
      const marks = markedIds(state, doc.key).length;
      fadedTotal += faded;
      markedTotal += marks;
      const picks = state.docs.get(doc.key)?.picks;
      if ((!faded && !marks) || picks?.kind !== "ready" || shown.has(doc.key)) continue;
      shown.add(doc.key);
      void log({
        type: "shown", cacheKey: picks.cacheKey,
        total: doc.sentences.length, faded, marks,
      }).catch(console.warn);
    }
    html.dataset.fillerCutFaded = String(fadedTotal);
    html.dataset.fillerCutMarked = String(markedTotal);
    const page = snapshot();
    const signature = JSON.stringify([href, page, current]);
    if (signature !== lastStatus) {
      lastStatus = signature;
      void chrome.runtime.sendMessage({
        type: "page-status-changed", page, revealed: current === "revealed",
      }).catch(console.warn);
    }
    settleFeedback(page.status);
  }

  function feedback(status: PageStatus) {
    if (status.kind !== "cut") toast(statusFeedback(status));
  }

  function settleFeedback(status?: PageStatus) {
    if (!pendingFeedback || !status || status.kind === "reading") return;
    const endPageMode = pendingFeedback === "page" && status.kind !== "cut";
    pendingFeedback = undefined;
    if (endPageMode) stop(status);
    toast();
    feedback(status);
  }

  function logClicks(type: "restore" | "unmark", docKey: DocKey, ids: readonly SentenceId[]) {
    const entry = state.docs.get(docKey);
    if (entry?.picks.kind !== "ready") return;
    const { cacheKey } = entry.picks;
    void log(...ids.map((id) => ({
      type, cacheKey, sentenceId: id, text: entry.doc.sentences[id - 1],
    }))).catch(console.warn);
  }

  function dispatch(event: PageEvent, pin?: Pin) {
    const next = reduce(state, event);
    if (next === state) return;
    state = next;
    render(pin);
    if (event.type === "restore") logClicks("restore", event.docKey, event.ids);
    if (event.type === "unmark") logClicks("unmark", event.docKey, [event.id]);
  }

  async function requestPicks(doc: Doc, check: SelectRequest["check"], requestedOn: number) {
    const isCurrent = () => requestedOn === pageView && href === location.href;
    try {
      // A short page gets no marks, so it keeps the fade-only cache entry.
      const { title, sentences } = doc;
      const request: SelectRequest = sentences.length >= MIN_MARK_SENTENCES
        ? { title, sentences, check, key: true } : { title, sentences, check };
      const answer: unknown = await chrome.runtime.sendMessage({ type: "select", doc: request });
      const picks = parseSelectResponse(answer);
      if (!picks) throw new Error(parseErrorResponse(answer)?.error ?? "Invalid selection response");
      if (isCurrent()) dispatch({ type: "picks-arrived", docKey: doc.key, ...picks });
    } catch (error) {
      if (isCurrent()) dispatch({ type: "picks-failed", docKey: doc.key, reason: error instanceof Error ? error.message : "Selection failed" });
    }
  }

  function scan() {
    if (!mode || (mode === "page" && !state.lensOn)) return;
    const version = ++scanVersion;
    // An earlier scan must never replace the status of a newer document or mutation.
    const current = () => version === scanVersion && href === location.href;
    const task = scanDocument(current).catch((error) => {
      if (!current()) return;
      scanError = "The page couldn't be read.";
      render();
      console.warn(error);
    });
    scanning = task;
    void task.then(() => { if (scanning === task) scanning = undefined; });
    return task;
  }

  async function scanDocument(current: () => boolean) {
    const start = performance.now();
    const url = new URL(href);
    const check = mode === "site" && usesGenericSurface(url) ? { url: url.origin + url.pathname } : undefined;
    const result = await extract(document, url, !!check, projection.read);
    if (!current()) return;

    scanError = undefined;
    hint = result.hint;
    anchoredDocs = result.docs.filter(({ root }) => root.isConnected);

    if (process.env.FILLER_CUT_DEV === "1") {
      document.documentElement.dataset.fillerCutDebug = JSON.stringify({
        docs: anchoredDocs.map(({ doc }) => doc),
        extractMs: performance.now() - start,
      });
    }
    for (const { doc } of anchoredDocs) {
      if (state.docs.has(doc.key)) continue;
      state = reduce(state, { type: "doc-found", doc });
      void requestPicks(doc, check, pageView);
    }
    render();
  }

  async function finishScan() {
    while (scanning) await scanning;
  }

  function reset(attempt?: PageStatus) {
    href = location.href;
    pageView++;
    scanVersion++;
    anchoredDocs = [];
    hint = undefined;
    scanError = undefined;
    lastAttempt = attempt;
    scanning = undefined;
    pendingFeedback = undefined;
    toast();
    shown.clear();
    log = createLog(href);
    dispatch({ type: "navigated" });
  }

  function stop(attempt?: PageStatus) {
    mode = undefined;
    state = { ...state, lensOn: false };
    reset(attempt);
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
    } else if (mode === "site" || lastAttempt) reset();
    else href = location.href;
    void scan();
  }

  let lensChanges = 0;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (mode !== "site" || area !== "local" || !changes.lensOn) return;
    lensChanges++;
    dispatch({ type: "lens-set", on: changes.lensOn.newValue !== false });
  });

  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message?.type === "page-status") {
      navigate();
      reply(snapshot());
    }
    if (message?.type === "press" && typeof message.url === "string") {
      navigate();
      const { url } = message;
      if (documentRoute(href) !== documentRoute(url) || hasFocusedEditor()) {
        reply(false);
      } else if (message.mode === "site") {
        if (mode !== "site") return;
        void pressSite(url).then(reply, () => reply(false));
        return true;
      } else if (message.mode === "page" && mode !== "site") {
        pressPage();
        reply(false);
      }
    }
    if (message?.type === "site-removed" && mode === "site" && message.origin === location.origin) {
      stop();
      reply(true);
    }
  });

  listenForToggle(() => {
    if (!mode) return false;
    void chrome.runtime.sendMessage({ type: "page-key", url: location.href }).catch(console.warn);
  });

  listenForHold(
    () => { if (mode) dispatch({ type: "hold-start" }); },
    (heldMs) => {
      if (!mode) return;
      const revealed = view(visibleState()) === "revealed";
      dispatch({ type: "hold-end" });
      if (revealed) void log({ type: "reveal", heldMs }).catch(console.warn);
    },
  );

  listenForMarkClick(projection.marks, ({ docKey, id }) => dispatch({ type: "unmark", docKey, id }));

  async function pressSite(url: string) {
    const requestedOn = pageView;
    if (!scanning) void scan();
    await finishScan();
    if (mode !== "site" || pageView !== requestedOn || documentRoute(location.href) !== documentRoute(url) ||
      hasFocusedEditor()) return false;
    const status = currentStatus();
    if (status.kind === "cut") return true;
    if (status.kind === "reading") pendingFeedback = "site";
    feedback(status);
    return false;
  }

  function pressPage() {
    if (state.lensOn) {
      const status = currentStatus();
      if (status.kind !== "reading" && status.kind !== "cut") {
        feedback(status);
        return;
      }
      scanVersion++;
      pendingFeedback = undefined;
      toast();
      dispatch({ type: "lens-set", on: false });
      return;
    }
    mode = "page";
    lastAttempt = undefined;
    dispatch({ type: "lens-set", on: true });
    pendingFeedback = "page";
    void scan();
  }

  const mutate = observePage(() => void scan(), navigate, projection.onMutations);
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

  return () => {
    navigate();
    if (mode === "site") return;
    mode = "site";
    reset();
    const changes = ++lensChanges;
    void chrome.storage.local.get("lensOn").then(({ lensOn }) => {
      if (mode !== "site") return;
      if (changes === lensChanges) dispatch({ type: "lens-set", on: lensOn !== false });
      return scan();
    });
  };
}

// Registration and immediate injection can meet in the same document.
const page = globalThis as typeof globalThis & { fillerCutRun?: ReturnType<typeof start> };
export function run(mode: Mode) {
  const enableSite = page.fillerCutRun ??= start();
  if (mode === "site") enableSite();
}
