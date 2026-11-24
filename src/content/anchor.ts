import { segment } from "../core/segment";
import { MAX_SENTENCES, MIN_SENTENCES } from "../shared/config";
import { docKey } from "../shared/keys";
import type { Doc } from "../shared/types";
import { surfaces } from "./surfaces";

export interface AnchoredDoc {
  readonly doc: Doc;
  readonly root: Element;
  readonly ranges: readonly Range[];
}

function anchor(block: Element, textWalker?: (block: Element) => TreeWalker) {
  const document = block.ownerDocument;
  const walker = textWalker?.(block) ?? document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const nodes: { node: Text; offset: number }[] = [];
  let text = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    // A <br> from the generic walker ends a sentence. The newline is whitespace, so no range starts or ends on it.
    if (!(node instanceof Text)) {
      text += "\n";
      continue;
    }
    if (!node.length) continue;
    nodes.push({ node, offset: text.length });
    // Generic pages hard-wrap their source. HTML renders those newlines as spaces.
    text += textWalker ? node.data.replace(/[\n\r\f]/gu, " ") : node.data;
  }

  let cursor = 0;
  return segment(text).map(({ start, end, text }) => {
    while (nodes[cursor + 1]?.offset <= start) cursor++;
    const first = nodes[cursor];
    while (nodes[cursor + 1]?.offset < end) cursor++;
    const last = nodes[cursor];
    const range = document.createRange();
    range.setStart(first.node, start - first.offset);
    range.setEnd(last.node, end - last.offset);
    return { range, text };
  });
}

export async function extract(document: Document, url: URL, checkArticle = false): Promise<AnchoredDoc[]> {
  const docs = surfaces(document, url, checkArticle).map(async ({ root, surface, title, blocks, textWalker }) => {
    const spans = blocks.flatMap((block) => anchor(block, textWalker));
    if (spans.length < MIN_SENTENCES || spans.length > MAX_SENTENCES) return;
    const sentences = spans.map(({ text }) => text);
    const key = await docKey(title, sentences);
    return { root, doc: { key, surface, title, sentences }, ranges: spans.map(({ range }) => range) };
  });
  return (await Promise.all(docs)).filter((doc): doc is NonNullable<typeof doc> => !!doc);
}
