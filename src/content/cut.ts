import { rangeOf, type SentenceAnchor, type TextSlice } from "./anchor";
import type { DocKey, SentenceId } from "../shared/types";

export const markerSelector = "[data-filler-cut-marker]";
const media = "img, svg, video, audio, iframe, canvas, input, select, textarea, button, hr";

type Expand = (docKey: DocKey, ids: readonly SentenceId[], sentence: SentenceAnchor, marker: HTMLElement) => void;
type Cut = TextSlice & { marker?: HTMLElement };
type Fragment = TextSlice & { text: Text; element: HTMLElement };

interface ProjectedText {
  readonly original: string;
  readonly fragments: Fragment[];
  edited: boolean;
}

export function createCut(expand: Expand) {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    [data-filler-cut-fragment] { display: contents !important }
    [data-filler-cut-collapsed] { display: none !important }
    ${markerSelector} {
      all: unset;
      display: inline;
      cursor: pointer;
      font: inherit;
      font-size: .85em;
      line-height: 1;
      letter-spacing: .1em;
      color: color-mix(in srgb, currentColor 52%, transparent);
      background: color-mix(in srgb, currentColor 9%, transparent);
      padding-inline: .35em;
      border-radius: 4px;
      white-space: nowrap;
      text-decoration: none;
    }
    ${markerSelector}:hover, ${markerSelector}:focus-visible { color: inherit }
    ${markerSelector}:focus-visible { outline: 1px solid currentColor }
  `);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];

  const projected = new Map<Text, ProjectedText>();
  const collapsed = new Set<Element>();
  const markers = new Set<HTMLElement>();
  const blocks = new Set<Element>();
  let dirty = false;

  function collapse(element: Element) {
    element.setAttribute("data-filler-cut-collapsed", "");
    collapsed.add(element);
  }

  function clear() {
    for (const marker of markers) marker.remove();
    for (const [node, { original, fragments, edited }] of projected) {
      for (const { element } of fragments) element.remove();
      if (!edited && node.data === "") node.data = original;
    }
    for (const element of collapsed) element.removeAttribute("data-filler-cut-collapsed");
    markers.clear();
    projected.clear();
    collapsed.clear();
    blocks.clear();
    dirty = false;
  }

  function foldEmptyLines(block: Element) {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, (node) => {
      if (node instanceof Text) return NodeFilter.FILTER_ACCEPT;
      if (!(node instanceof Element)) return NodeFilter.FILTER_SKIP;
      if (node.matches("[hidden], [aria-hidden=true]") && !node.matches(markerSelector)) return NodeFilter.FILTER_REJECT;
      return node.matches(`br, ${markerSelector}, ${media}`) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    });
    let content = false;
    let anyContent = false;
    let lineBreaks: Element[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node instanceof Text && !(projected.get(node)?.original ?? node.data).trim()) continue;
      if (node instanceof Element && node.localName === "br") {
        lineBreaks.push(node);
        continue;
      }
      if (lineBreaks.length) {
        if (!content) lineBreaks.forEach(collapse);
        lineBreaks = [];
        content = false;
      }
      if (!(node instanceof Text) || node.data.trim()) content = anyContent = true;
    }
    if (!content) lineBreaks.forEach(collapse);
    if (!anyContent && !block.matches("body, td, th")) collapse(block);
  }

  function makeMarker(docKey: DocKey, ids: readonly SentenceId[], sentence: SentenceAnchor) {
    const marker = document.createElement("span");
    marker.dataset.fillerCutMarker = "";
    marker.textContent = "···";
    marker.tabIndex = 0;
    marker.setAttribute("role", "button");
    marker.title = `Show ${ids.length} removed ${ids.length === 1 ? "sentence" : "sentences"}`;
    marker.setAttribute("aria-label", marker.title);
    let wasSelected = false;
    marker.addEventListener("pointerdown", () => { wasSelected = document.getSelection()?.isCollapsed === false; });
    marker.addEventListener("click", (event) => {
      const selecting = wasSelected || document.getSelection()?.isCollapsed === false;
      wasSelected = false;
      if (!event.isTrusted || event.button !== 0) return;
      // A marker can sit within a link's text. Only its own click is handled here.
      event.preventDefault();
      event.stopPropagation();
      if (!selecting) expand(docKey, ids, sentence, marker);
    });
    marker.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) expand(docKey, ids, sentence, marker);
    });
    markers.add(marker);
    return marker;
  }

  function apply(docs: readonly { docKey: DocKey; runs: readonly SentenceId[][]; sentences: readonly SentenceAnchor[] }[]) {
    const cuts = new Map<Text, Cut[]>();
    const links = new Set<Element>();
    for (const { docKey, runs, sentences } of docs) {
      for (const ids of runs) {
        const first = sentences[ids[0] - 1];
        if (!first.slices[0].node.isConnected) continue;
        let marker: HTMLElement | undefined = makeMarker(docKey, ids, first);
        for (const id of ids) {
          const { block, slices } = sentences[id - 1];
          blocks.add(block);
          for (const slice of slices) {
            if (!slice.node.isConnected) continue;
            const link = slice.node.parentElement?.closest("a, [role=link]");
            if (link) links.add(link);
            const list = cuts.get(slice.node) ?? [];
            const last = list.at(-1);
            // Whitespace between adjacent removed sentences also belongs to the run.
            if (!marker && last && !slice.node.data.slice(last.end, slice.start).trim()) {
              list[list.length - 1] = { ...last, end: slice.end };
            } else {
              list.push({ ...slice, marker });
            }
            cuts.set(slice.node, list);
            marker = undefined;
          }
        }
      }
    }

    for (const [node, slices] of cuts) {
      const original = node.data;
      const fragments: Fragment[] = [];
      const replacement = document.createDocumentFragment();
      let start = 0;
      function keep(end: number) {
        if (end <= start) return;
        const element = document.createElement("span");
        element.dataset.fillerCutFragment = "";
        const text = document.createTextNode(original.slice(start, end));
        element.append(text);
        replacement.append(element);
        fragments.push({ node, start, end, text, element });
      }
      for (const slice of slices) {
        keep(slice.start);
        if (slice.marker) replacement.append(slice.marker);
        start = slice.end;
      }
      keep(original.length);
      // React can still set, insert before, or remove its original Text child.
      node.data = "";
      node.after(replacement);
      projected.set(node, { original, fragments, edited: false });
    }

    for (const link of links) {
      if (link.textContent?.trim() || link.querySelector(media)) continue;
      collapse(link);
    }
    for (const block of blocks) foldEmptyLines(block);
  }

  return {
    read(node: Text) {
      const source = projected.get(node);
      return source && !source.edited && node.data === "" ? source.original : node.data;
    },
    locate(slice: TextSlice): TextSlice | undefined {
      const source = projected.get(slice.node);
      if (!source || source.edited) return slice.end <= slice.node.length ? slice : undefined;
      const part = source.fragments.find(({ start, end }) => start <= slice.start && end >= slice.end);
      if (part) return { node: part.text, start: slice.start - part.start, end: slice.end - part.start };
    },
    onMutations(records: MutationRecord[]) {
      for (const { type, target } of records) {
        if (type === "characterData") {
          const source = projected.get(target as Text);
          if (source) source.edited = dirty = true;
        }
        if (!dirty && type === "childList") {
          for (const block of blocks) {
            if (block.contains(target)) {
              dirty = true;
              break;
            }
          }
        }
      }
    },
    get dirty() { return dirty; },
    clear,
    apply,
  };
}

export function firstRect(sentence: SentenceAnchor, locate: Parameters<typeof rangeOf>[1]) {
  const slice = sentence.slices[0];
  const range = rangeOf({ ...sentence, slices: [{ ...slice, end: slice.start + 1 }] }, locate);
  return range?.getClientRects()[0];
}
