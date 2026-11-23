import { extract } from "../../../src/content/anchor";
import type { Doc } from "../../../src/shared/types";
import type { Box } from "./pixels";

export interface Geometry {
  doc: Doc;
  sentences: Box[][];
  protectedText: Box[];
  excludedHits: number;
  colors: string[];
}

const headers = "[data-testid=twitter-article-title], [data-testid=User-Name], [data-article-part=byline], h1";
const excluded = "h1, h2, h3, h4, h5, h6, table, pre, code, figure, figcaption, nav, footer, header, aside, form";

function box({ x, y, width, height }: DOMRect): Box {
  return { x, y, width, height };
}

declare global {
  interface Window {
    fillerCutGeometry: () => Promise<Geometry | undefined>;
  }
}

window.fillerCutGeometry = async () => {
  const [anchored] = await extract(document, new URL(location.href));
  if (!anchored) return;
  const { doc, root, ranges } = anchored;
  const closestArticle = root.closest("article[data-testid=tweet]") ?? root.closest("article") ?? root;
  const protectedText = [...closestArticle.querySelectorAll(headers)].map((element) => box(element.getBoundingClientRect()));
  let excludedHits = 0;
  if (doc.surface === "blog") {
    const elements = root.querySelectorAll(excluded);
    for (const range of ranges) for (const element of elements) {
      if (range.intersectsNode(element)) excludedHits++;
    }
  }
  return {
    doc,
    protectedText,
    excludedHits,
    colors: ranges.map((range) => getComputedStyle(range.startContainer.parentElement ?? root).color),
    sentences: ranges.map((range) => [...range.getClientRects()].map(box)),
  };
};
