import { extract } from "./anchor";

async function scan() {
  const start = performance.now();
  const docs = await extract(document, new URL(location.href));
  if (docs.length) initialRender.disconnect();
  if (process.env.FILLER_CUT_DEV === "1") {
    document.documentElement.dataset.fillerCutDebug = JSON.stringify({
      docs: docs.map(({ doc }) => doc),
      extractMs: performance.now() - start,
    });
  }
}


// X can stream the status after the content script starts.
const initialRender = new MutationObserver(() => void scan());
initialRender.observe(document.documentElement, { childList: true, subtree: true });

void scan();
