import { segment } from "../core/segment";
import { MAX_SENTENCES, MIN_SENTENCES } from "../shared/config";
import { docKey } from "../shared/keys";
import type { Doc } from "../shared/types";
import { surfaces, textWalker, type ReadText } from "./surfaces";

export interface TextSlice {
  readonly node: Text;
  readonly start: number;
  readonly end: number;
}

export interface SentenceAnchor {
  readonly block: Element;
  readonly slices: readonly TextSlice[];
}

export interface AnchoredDoc {
  readonly doc: Doc;
  readonly root: Element;
  readonly sentences: readonly SentenceAnchor[];
}

export type LocateText = (slice: TextSlice) => TextSlice | undefined;

export function rangeOf({ slices }: SentenceAnchor, locate: LocateText = (slice) => slice) {
  const first = locate(slices[0]);
  const last = locate(slices.at(-1)!);
  if (!first?.node.isConnected || !last?.node.isConnected) return;
  const range = first.node.ownerDocument.createRange();
  range.setStart(first.node, first.start);
  range.setEnd(last.node, last.end);
  return range;
}

function anchor(block: Element, generic: boolean, read: ReadText) {
  const walker = textWalker(block, generic);
  const nodes: { node: Text; offset: number; length: number }[] = [];
  let text = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node instanceof Text)) {
      text += "\n";
      continue;
    }
    const data = read(node);
    if (!data.length) continue;
    nodes.push({ node, offset: text.length, length: data.length });
    text += generic ? data.replace(/[\n\r\f]/gu, " ") : data;
  }

  let cursor = 0;
  return segment(text).map(({ start, end, text }) => {
    while (nodes[cursor + 1]?.offset <= start) cursor++;
    const slices: TextSlice[] = [];
    for (; cursor < nodes.length; cursor++) {
      const { node, offset, length } = nodes[cursor];
      const from = Math.max(start - offset, 0);
      const to = Math.min(end - offset, length);
      if (to > from) slices.push({ node, start: from, end: to });
      if (!nodes[cursor + 1] || nodes[cursor + 1].offset >= end) break;
    }
    return { sentence: { block, slices }, text };
  });
}

export async function extract(
  document: Document, url: URL, checkArticle = false, read: ReadText = (node) => node.data,
): Promise<AnchoredDoc[]> {
  const docs = surfaces(document, url, checkArticle, read).map(async ({ root, surface, title, blocks, generic }) => {
    const spans = blocks.flatMap((block) => anchor(block, !!generic, read));
    if (spans.length < MIN_SENTENCES || spans.length > MAX_SENTENCES) return;
    const sentences = spans.map(({ text }) => text);
    const key = await docKey(title, sentences);
    return { root, doc: { key, surface, title, sentences }, sentences: spans.map(({ sentence }) => sentence) };
  });
  return (await Promise.all(docs)).filter((doc): doc is NonNullable<typeof doc> => !!doc);
}
