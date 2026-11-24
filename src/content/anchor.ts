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
    const piece = node as Text;
    if (!piece.length) continue;
    nodes.push({ node: piece, offset: text.length });
    text += piece.data;
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

export async function extract(document: Document, url: URL): Promise<AnchoredDoc[]> {
  const docs = surfaces(document, url).map(async ({ root, surface, title, blocks, textWalker }) => {
    const spans = blocks.flatMap((block) => anchor(block, textWalker));
    if (spans.length < MIN_SENTENCES || spans.length > MAX_SENTENCES) return;
    const sentences = spans.map(({ text }) => text);
    const key = await docKey(title, sentences);
    return { root, doc: { key, surface, title, sentences }, ranges: spans.map(({ range }) => range) };
  });
  return (await Promise.all(docs)).filter((doc): doc is NonNullable<typeof doc> => !!doc);
}
