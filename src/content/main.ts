import { fadedIds, reduce, view, type PageEvent, type PageState } from "../core/state";
import type { Doc } from "../shared/types";
import { parseErrorResponse, parseSelectResponse } from "../shared/wire";
import { extract, type AnchoredDoc } from "./anchor";
import { listenForHold } from "./hold";
import { listenForToggle } from "./keys";
import { createPainter } from "./paint";

const paint = createPainter();

let state: PageState = { lensOn: false, holding: false, docs: new Map() };
let anchoredDocs: AnchoredDoc[] = [];

function render() {
  paint(anchoredDocs, state);
  const html = document.documentElement;
  html.dataset.fillerCutState = view(state);
  html.dataset.fillerCutFaded = String(anchoredDocs.reduce(
    (total, { doc }) => total + fadedIds(state, doc.key).length, 0,
  ));
}

function dispatch(event: PageEvent) {
  state = reduce(state, event);
  render();
}

async function requestPicks(doc: Doc) {
  try {
    const answer: unknown = await chrome.runtime.sendMessage({ type: "select", doc });
    const picks = parseSelectResponse(answer);
    if (!picks) throw new Error(parseErrorResponse(answer)?.error ?? "Invalid selection response");
    dispatch({ type: "picks-arrived", docKey: doc.key, ...picks });
  } catch (error) {
    dispatch({ type: "picks-failed", docKey: doc.key, reason: String(error) });
  }
}

async function scan() {
  const start = performance.now();
  const docs = await extract(document, new URL(location.href));
  anchoredDocs = docs;
  if (docs.length) initialRender.disconnect();
  if (process.env.FILLER_CUT_DEV === "1") {
    document.documentElement.dataset.fillerCutDebug = JSON.stringify({
      docs: docs.map(({ doc }) => doc),
      extractMs: performance.now() - start,
    });
  }
  for (const { doc } of docs) {
    if (state.docs.has(doc.key)) continue;
    dispatch({ type: "doc-found", doc });
    void requestPicks(doc);
  }
  render();
}


// X can stream the status after the content script starts.
const initialRender = new MutationObserver(() => void scan());
initialRender.observe(document.documentElement, { childList: true, subtree: true });

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
  () => dispatch({ type: "hold-end" }),
);

void chrome.storage.local.get("lensOn").then(({ lensOn }) => {
  if (!lensChanges) dispatch({ type: "lens-set", on: lensOn !== false });
  return scan();
});
