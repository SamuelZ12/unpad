import { pageStatus, type PageStatus } from "../core/page-status";
import { fadedIds, markedIds, reduce, view, type DocState, type PageEvent, type PageState } from "../core/state";
import type { Doc, DocKey, SentenceId } from "../shared/types";
import { parseErrorResponse, parseSelectResponse, type SelectRequest } from "../shared/wire";
import { documentRoute, type PageSnapshot } from "../shared/page-snapshot";
import { statusFeedback } from "../shared/status-copy";
import { issue } from "../shared/connection";
import { MIN_MARK_SENTENCES } from "../shared/config";
import { extract, type AnchoredDoc } from "./anchor";
import { createLog } from "./log";
import { listenForHold } from "./hold";
import { hasFocusedEditor, listenForToggle } from "./keys";
import { observePage } from "./observe";
import { createProjection } from "./reconcile";
import { createToast } from "./toast";
import { usesGenericSurface } from "./surfaces";

type Mode = "site" | "page";

const recentUnmountedLimit = 128;

function start() {
  const projection = createProjection((action) => {
    dispatch(action.event, action);
  });
  let href = location.href;
  let log = createLog(href);
  let pageView = 0;
  let scanVersion = 0;
  let mutationVersion = 0;
  let scannedMutation = 0;
  let mode: Mode | undefined;
  const shown = new Set<Doc["key"]>();
  const bridgeForDoc = new Map<DocKey, string>();

  let state: PageState = { lensOn: false, holding: false, docs: new Map() };
  let anchoredDocs: AnchoredDoc[] = [];
  let scanned = false;
  let scanError: string | undefined;
  let lastAttempt: PageStatus | undefined;
  let scanning: Promise<void> | undefined;
  // A press that arrives while picks are pending waits for them. A site press then reports whether to toggle.
  let pendingFeedback: { mode: "page" } | { mode: "site"; settle: (status?: PageStatus) => void } | undefined;
  let lastStatus: string | undefined;
  const toast = createToast((change) => mutate(change));

  function mountedEntries(): DocState[] {
    return anchoredDocs.flatMap(({ doc }) => {
      const entry = state.docs.get(doc.key);
      return entry ? [entry] : [];
    });
  }

  function visibleState(mounted = mountedEntries()): PageState {
    return { ...state, docs: new Map(mounted.map((entry) => [entry.doc.key, entry])) };
  }

  function currentStatus(mounted = mountedEntries()): PageStatus {
    return scanError ? { kind: "failed", reason: scanError } : pageStatus(state, scanned, mounted);
  }

  function snapshot(mounted?: DocState[]): PageSnapshot {
    const { lensOn } = state;
    if (mode === "site" && !connected) return { mode, lensOn };
    return { mode, lensOn, status: mode ? currentStatus(mounted) : lastAttempt };
  }

  type RunAction = Parameters<typeof projection.reconcile>[2];

  // An extension reload orphans this script. Leave the page to the script injected after it.
  const orphaned = () => !chrome.runtime?.id;

  function render(action?: RunAction) {
    if (orphaned()) return;
    const control = mutate(() => projection.reconcile(anchoredDocs, state, action));
    const html = document.documentElement;
    const mounted = mountedEntries();
    const current = view(visibleState(mounted));
    html.dataset.fillerCutState = current;
    let fadedTotal = 0;
    let markedTotal = 0;
    for (const { doc, picks } of mounted) {
      const faded = fadedIds(state, doc.key).length;
      const marks = markedIds(state, doc.key).length;
      fadedTotal += faded;
      markedTotal += marks;
      const bridge = bridgeForDoc.get(doc.key);
      if (!bridge || (!faded && !marks) || picks.kind !== "ready" || shown.has(doc.key)) continue;
      shown.add(doc.key);
      void log(bridge, {
        type: "shown", cacheKey: picks.cacheKey,
        total: doc.sentences.length, faded, marks,
      }).catch(console.warn);
    }
    html.dataset.fillerCutFaded = String(fadedTotal);
    html.dataset.fillerCutMarked = String(markedTotal);
    const page = snapshot(mounted);
    const signature = JSON.stringify([href, page, current]);
    if (signature !== lastStatus) {
      lastStatus = signature;
      void chrome.runtime.sendMessage({
        type: "page-status-changed", page, revealed: current === "revealed",
      }).catch(console.warn);
    }
    settleFeedback(page.status);
    control?.focus({ preventScroll: true });
  }

  function feedback(status: PageStatus) {
    if (status.kind !== "cut") toast(statusFeedback(status));
  }

  function settleFeedback(status?: PageStatus) {
    if (!pendingFeedback || !status || status.kind === "reading") return;
    const pending = pendingFeedback;
    pendingFeedback = undefined;
    if (pending.mode === "page" && status.kind !== "cut") stop(status);
    toast();
    feedback(status);
    if (pending.mode === "site") pending.settle(status);
  }

  function cancelFeedback() {
    if (pendingFeedback?.mode === "site") pendingFeedback.settle();
    pendingFeedback = undefined;
  }

  function logClicks(type: "restore" | "recut", docKey: DocKey, ids: readonly SentenceId[]) {
    const entry = state.docs.get(docKey);
    const bridge = bridgeForDoc.get(docKey);
    if (!bridge || entry?.picks.kind !== "ready") return;
    const { cacheKey } = entry.picks;
    void log(bridge, ...ids.map((id) => ({
      type, cacheKey, sentenceId: id, text: entry.doc.sentences[id - 1],
    }))).catch(console.warn);
  }

  function dispatch(event: PageEvent, action?: RunAction) {
    const next = reduce(state, event);
    if (next === state) return;
    state = next;
    render(action);
    if (event.type === "restore" || event.type === "recut") logClicks(event.type, event.docKey, event.ids);
  }

  async function requestPicks(entry: DocState, check: SelectRequest["check"]) {
    const { doc } = entry;
    const isCurrent = () => state.docs.get(doc.key) === entry && href === location.href;
    async function report(event: PageEvent) {
      if (doc.surface === "x-post") {
        mutate(() => {});
        if (!scanning && scannedMutation !== mutationVersion) void scan();
        await finishScan();
        if (isCurrent() && (scanError || scannedMutation !== mutationVersion)) {
          state = reduce(state, event);
          return;
        }
      }
      if (isCurrent()) dispatch(event);
    }
    try {
      // A short page gets no marks, so it keeps the fade-only cache entry.
      const { title, sentences } = doc;
      const request: SelectRequest = sentences.length >= MIN_MARK_SENTENCES
        ? { title, sentences, check, key: true } : { title, sentences, check };
      const answer: unknown = await chrome.runtime.sendMessage({ type: "select", doc: request });
      const picks = parseSelectResponse(answer);
      if (!picks) throw new Error(parseErrorResponse(answer)?.error ?? "Invalid selection response");
      if (!isCurrent()) return;
      const { bridge } = answer as { bridge?: string };
      if (typeof bridge === "string") bridgeForDoc.set(doc.key, bridge);
      await report({ type: "picks-arrived", docKey: doc.key, ...picks });
    } catch (error) {
      if (isCurrent()) await report({ type: "picks-failed", docKey: doc.key, reason: error instanceof Error ? error.message : "Selection failed" });
    }
  }

  function scan() {
    if (orphaned() || (mode === "site" && !connected) || !mode || (mode === "page" && !state.lensOn)) return;
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
    const readAt = mutate(() => mutationVersion);
    const docs = await extract(document, url, !!check, projection.read);
    if (!current() || (url.hostname === "x.com" && readAt !== mutate(() => mutationVersion))) return;

    scanError = undefined;
    scanned = true;
    scannedMutation = readAt;
    anchoredDocs = docs.filter(({ root }) => root.isConnected);
    if (url.hostname === "x.com") retainRecentDocs();

    if (process.env.FILLER_CUT_DEV === "1") {
      document.documentElement.dataset.fillerCutDebug = JSON.stringify({
        docs: anchoredDocs.map(({ doc }) => doc),
        extractMs: performance.now() - start,
      });
    }
    for (const { doc } of anchoredDocs) {
      if (state.docs.has(doc.key)) continue;
      state = reduce(state, { type: "doc-found", doc });
      void requestPicks(state.docs.get(doc.key)!, check);
    }
    render();
  }

  function retainRecentDocs() {
    // Move mounted docs to the end so the oldest unmounted entries are evicted first.
    const mounted = visibleState().docs;
    const docs = new Map(state.docs);
    for (const key of mounted.keys()) docs.delete(key);
    for (const key of docs.keys()) {
      if (docs.size <= recentUnmountedLimit) break;
      docs.delete(key);
      shown.delete(key);
      bridgeForDoc.delete(key);
    }
    for (const [key, entry] of mounted) docs.set(key, entry);
    state = { ...state, docs };
  }

  async function finishScan() {
    while (scanning) await scanning;
  }

  function reset(attempt?: PageStatus) {
    href = location.href;
    pageView++;
    scanVersion++;
    anchoredDocs = [];
    scanned = false;
    scanError = undefined;
    lastAttempt = attempt;
    scanning = undefined;
    cancelFeedback();
    toast();
    shown.clear();
    bridgeForDoc.clear();
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
    } else reset();
  }

  let connected = false;
  let lensChanges = 0;
  function applyPreferences(preferences: { connected?: boolean; lensOn?: boolean; restart?: boolean }) {
    lensChanges++;
    const first = !connected && preferences.connected;
    connected = preferences.connected === true;
    if (preferences.restart && (mode === "page" || (!mode && lastAttempt))) stop();
    if (mode === "site") {
      if (preferences.restart) reset();
      dispatch({ type: "lens-set", on: connected && preferences.lensOn !== false });
      if (connected && (first || preferences.restart)) void scan();
    }
  }

  async function readSitePreferences(restart = false) {
    const changes = lensChanges;
    try {
      const preferences = await chrome.runtime.sendMessage({ type: "reading-preferences" });
      if (mode === "site" && changes === lensChanges) applyPreferences({ ...preferences, restart });
    } catch {
      if (mode === "site" && changes === lensChanges) render();
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message?.type === "reading-preferences") applyPreferences(message);
    if (message?.type === "needs-setup") {
      if (!hasFocusedEditor() && documentRoute(location.href) === documentRoute(message.url)) toast({ title: issue.setup });
      reply(true);
    }
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
      const bridge = anchoredDocs.map(({ doc }) => bridgeForDoc.get(doc.key)).find(Boolean);
      if (revealed && bridge) void log(bridge, { type: "reveal", heldMs }).catch(console.warn);
    },
  );


  async function pressSite(url: string) {
    const requestedOn = pageView;
    const current = () => mode === "site" && pageView === requestedOn && documentRoute(location.href) === documentRoute(url);
    if (!connected) await readSitePreferences();
    if (!connected) {
      toast({ title: issue.offline });
      return false;
    }
    await finishScan();
    if (!current()) return false;
    const docs = new Map(state.docs);
    for (const [key, entry] of docs) {
      if (entry.picks.kind !== "failed") continue;
      const { reason } = entry.picks;
      if ([issue.offline, issue.rate, issue.usage, issue.reply].some((message) => message === reason)) docs.delete(key);
    }
    state = { ...state, docs };
    await scan();
    await finishScan();
    if (!current() || hasFocusedEditor()) return false;
    let status: PageStatus | undefined = currentStatus();
    feedback(status);
    if (status.kind === "reading") {
      cancelFeedback();
      status = await new Promise<PageStatus | undefined>((settle) => { pendingFeedback = { mode: "site", settle }; });
    }
    return status?.kind === "cut" && current();
  }

  function pressPage() {
    if (state.lensOn) {
      // Before the first scan lands there is nothing to keep, so end the attempt.
      if (!scanned) return stop();
      scanVersion++;
      cancelFeedback();
      toast();
      dispatch({ type: "lens-set", on: false });
      return;
    }
    mode = "page";
    lastAttempt = undefined;
    dispatch({ type: "lens-set", on: true });
    pendingFeedback = { mode: "page" };
    void scan();
  }

  const mutate = observePage(() => void scan(), navigate, (records) => {
    mutationVersion++;
    projection.onMutations(records);
  });
  window.addEventListener("pagehide", () => {
    if (mode === "page") stop();
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted && mode === "site") {
      void chrome.runtime.sendMessage({ type: "site-enabled" }).then((enabled) => {
        if (mode !== "site") return;
        if (!enabled) stop();
        else void readSitePreferences(true);
      }).catch(console.warn);
    }
  });

  return () => {
    navigate();
    if (mode === "site") return;
    mode = "site";
    connected = false;
    reset();
    void readSitePreferences();
  };
}

// Registration and immediate injection can meet in the same document.
const page = globalThis as typeof globalThis & { fillerCutRun?: ReturnType<typeof start> };
export function run(mode: Mode) {
  const enableSite = page.fillerCutRun ??= start();
  if (mode === "site") enableSite();
}
