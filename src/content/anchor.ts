import { segment } from "../core/segment";
import { MAX_SENTENCES, MIN_SENTENCES } from "../shared/config";
import { docKey, randomId } from "../shared/keys";
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

function readBlock(block: Element, generic: boolean, read: ReadText, excludePrivate: boolean) {
  const walker = textWalker(block, generic, excludePrivate);
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

  return { text, nodes };
}

function anchor(block: Element, { nodes, text }: ReturnType<typeof readBlock>) {
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

export function createExtractor() {
  const posts = new WeakMap<Element, {
    identity?: string;
    anonymous: boolean;
    source: ReturnType<typeof readBlock>;
    result: Promise<AnchoredDoc | undefined>;
  }>();

  return async function extract(
    document: Document, url: URL, checkArticle = false, read: ReadText = (node) => node.data,
  ): Promise<AnchoredDoc[]> {
    const docs = surfaces(document, url, checkArticle, read).map(({ root, surface, title, blocks, generic, identity }) => {
      const previous = posts.get(root);
      const anonymous = identity === null;
      let keyPrefix = identity ?? undefined;
      if (anonymous) keyPrefix = previous?.anonymous ? previous.identity : randomId();
      async function build(spans: ReturnType<typeof anchor>): Promise<AnchoredDoc | undefined> {
        if (spans.length < MIN_SENTENCES || spans.length > MAX_SENTENCES) return;
        const sentences = spans.map(({ text }) => text);
        const key = await docKey(keyPrefix === undefined ? title : JSON.stringify([keyPrefix, title]), sentences);
        return { root, doc: { key, surface, title, sentences }, sentences: spans.map(({ sentence }) => sentence) };
      }

      if (surface !== "x-post") return build(blocks.flatMap((block) => anchor(block, readBlock(block, !!generic, read, !!generic || surface === "x-article"))));
      const source = readBlock(root, false, read, true);
      if (previous && keyPrefix === previous.identity && source.text === previous.source.text && source.nodes.length === previous.source.nodes.length &&
        source.nodes.every(({ node, length }, i) => node === previous.source.nodes[i].node && length === previous.source.nodes[i].length)) {
        return previous.result;
      }
      const result = build(anchor(root, source));
      posts.set(root, { identity: keyPrefix, anonymous, source, result });
      void result.catch(() => { if (posts.get(root)?.result === result) posts.delete(root); });
      return result;
    });
    return (await Promise.all(docs)).filter((doc): doc is AnchoredDoc => !!doc);
  };
}

export const extract = createExtractor();
