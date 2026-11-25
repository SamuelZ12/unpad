import { extract, rangeOf } from "../../../src/content/anchor";
import type { Doc } from "../../../src/shared/types";
import type { Box } from "./pixels";

export interface Geometry {
  doc: Doc;
  sentences: Box[][];
  protectedText: Box[];
}

const headers = "[data-testid=twitter-article-title], [data-testid=User-Name], [data-article-part=byline], h1";
function box({ x, y, width, height }: DOMRect): Box {
  return { x, y, width, height };
}

declare global {
  interface Window {
    fillerCutGeometry: () => Promise<Geometry | undefined>;
  }
}

window.fillerCutGeometry = async () => {
  const [anchored] = (await extract(document, new URL(location.href))).docs;
  if (!anchored) return;
  const { doc, root, sentences } = anchored;
  const ranges = sentences.map((sentence) => rangeOf(sentence)!);
  const closestArticle = root.closest("article[data-testid=tweet]") ?? root.closest("article") ?? root;
  const protectedText = [...closestArticle.querySelectorAll(headers)].map((element) => box(element.getBoundingClientRect()));
  return {
    doc,
    protectedText,
    sentences: ranges.map((range) => [...range.getClientRects()].map(box)),
  };
};
