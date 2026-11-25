import { rangeOf, type SentenceAnchor, type TextSlice } from "./anchor";
import type { DocKey, SentenceId } from "../shared/types";
import type { RunEvent } from "../core/state";
import { isEditing } from "./keys";

export const markerSelector = "[data-filler-cut-marker]";
const restoredSelector = "[data-filler-cut-restored]";
const linkSelector = "a, [role=link]";
const interactive = `${linkSelector}, button, [role=button]:not(${restoredSelector}), summary, label`;
const media = "img, svg, video, audio, iframe, canvas, input, select, textarea, button, hr";

type Activate = (event: RunEvent, sentence: SentenceAnchor, top: number) => void;
type Run = { event: RunEvent; sentence: SentenceAnchor; parts: HTMLElement[] };
type RunSlice = TextSlice & { run: Run };
type Fragment = TextSlice & { text: Text; element: HTMLElement };

interface ProjectedText {
  readonly original: string;
  readonly fragments: Fragment[];
  edited: boolean;
}

export function createCut(activate: Activate) {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    [data-filler-cut-fragment] { display: contents !important }
    [data-filler-cut-collapsed] { display: none !important }
    ${markerSelector} {
      all: unset;
      display: inline;
      cursor: pointer;
      user-select: none;
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
    ${restoredSelector} {
      display: inline !important;
      color: color-mix(in srgb, currentColor 55%, transparent);
      cursor: pointer;
    }
    ${restoredSelector}[data-filler-cut-hover] {
      background-color: color-mix(in srgb, currentColor calc(9% / .55), transparent);
    }
    :is(${markerSelector}, ${restoredSelector}):focus-visible { outline: 1px solid currentColor }
  `);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];

  const projected = new Map<Text, ProjectedText>();
  const collapsed = new Set<Element>();
  const controls = new Map<HTMLElement, Run>();
  const starts = new Map<string, HTMLElement>();
  const runKey = ({ docKey, ids }: RunEvent) => `${docKey}:${ids[0]}`;
  let hovered: Run | undefined;
  const blocks = new Set<Element>();
  let dirty = false;

  function collapse(element: Element) {
    element.setAttribute("data-filler-cut-collapsed", "");
    collapsed.add(element);
  }

  function clear() {
    for (const [control, run] of controls) {
      if (run.event.type === "restore") control.remove();
    }
    for (const [node, { original, fragments, edited }] of projected) {
      for (const { element } of fragments) element.remove();
      if (!edited && node.data === "") node.data = original;
    }
    for (const element of collapsed) element.removeAttribute("data-filler-cut-collapsed");
    controls.clear();
    starts.clear();
    hovered = undefined;
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

  function controlRun(target: EventTarget | null) {
    return target instanceof HTMLElement ? controls.get(target) : undefined;
  }

  function hover(run: Run | undefined) {
    if (hovered === run) return;
    for (const part of hovered?.parts ?? []) part.removeAttribute("data-filler-cut-hover");
    hovered = run;
    for (const part of run?.parts ?? []) part.setAttribute("data-filler-cut-hover", "");
  }

  window.addEventListener("pointerover", (event) => {
    const run = controlRun(event.target);
    hover(run?.event.type === "recut" ? run : undefined);
  }, true);
  window.addEventListener("pointerout", (event) => {
    if (hovered !== controlRun(event.relatedTarget)) hover(undefined);
  }, true);

  let wasSelected = false;
  window.addEventListener("pointerdown", () => {
    wasSelected = document.getSelection()?.isCollapsed === false;
  }, true);
  window.addEventListener("click", (event) => {
    const selecting = wasSelected || document.getSelection()?.isCollapsed === false;
    wasSelected = false;
    const run = controlRun(event.target);
    if (!run || !event.isTrusted || event.button !== 0 || isEditing(event)) return;
    if (run.event.type === "recut" && (selecting || event.composedPath().some(
      (target) => target instanceof Element && target.matches(interactive)))) return;
    // Markers within inline links must handle the click before the site can follow it.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!selecting) {
      const top = run.event.type === "recut" && event.detail > 0
        ? event.clientY : run.parts[0].getBoundingClientRect().top;
      activate(run.event, run.sentence, top);
    }
  }, true);
  window.addEventListener("keydown", (event) => {
    const run = controlRun(event.target);
    if (!run || event.target !== run.parts[0] || !event.isTrusted || isEditing(event) ||
      (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) activate(run.event, run.sentence, run.parts[0].getBoundingClientRect().top);
  }, true);

  function addControl(run: Run, element: HTMLElement) {
    const { type, ids } = run.event;
    const expand = type === "restore";
    if (expand) {
      element.dataset.fillerCutMarker = "";
      element.textContent = "···";
    } else element.dataset.fillerCutRestored = "";
    const verb = expand ? "Show" : "Hide";
    const noun = ids.length === 1 ? "sentence" : "sentences";
    element.title = `${verb} ${ids.length} ${expand ? "removed " : ""}${noun}`;
    if (!run.parts.length) {
      element.tabIndex = 0;
      element.setAttribute("role", "button");
      element.setAttribute("aria-label", element.title);
      starts.set(runKey(run.event), element);
    }
    run.parts.push(element);
    controls.set(element, run);
  }

  function apply(docs: readonly {
    docKey: DocKey;
    removed: readonly SentenceId[][];
    restored: readonly SentenceId[][];
    sentences: readonly SentenceAnchor[];
  }[]) {
    const slicesByNode = new Map<Text, RunSlice[]>();
    const links = new Set<Element>();
    const foldedBlocks = new Set<Element>();
    for (const { docKey, removed, restored, sentences } of docs) {
      function project(type: RunEvent["type"], groups: readonly SentenceId[][]) {
        for (const ids of groups) {
          const sentence = sentences[ids[0] - 1];
          if (!sentence.slices[0].node.isConnected) continue;
          const run: Run = { event: { type, docKey, ids }, sentence, parts: [] };
          for (const id of ids) {
            const { block, slices } = sentences[id - 1];
            blocks.add(block);
            if (type === "restore") foldedBlocks.add(block);
            for (const slice of slices) {
              if (!slice.node.isConnected) continue;
              const link = slice.node.parentElement?.closest(linkSelector);
              if (link && type === "restore") links.add(link);
              const list = slicesByNode.get(slice.node) ?? [];
              const last = list.at(-1);
              if (last?.run === run && !slice.node.data.slice(last.end, slice.start).trim()) {
                list[list.length - 1] = { ...last, end: slice.end };
              } else list.push({ ...slice, run });
              slicesByNode.set(slice.node, list);
            }
          }
        }
      }
      project("restore", removed);
      project("recut", restored);
    }

    for (const [node, slices] of [...slicesByNode].sort(([a], [b]) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)) {
      const original = node.data;
      const fragments: Fragment[] = [];
      const replacement = document.createDocumentFragment();
      let start = 0;
      function keep(end: number, run?: Run) {
        if (end <= start) return;
        const element = document.createElement("span");
        if (run) addControl(run, element);
        else element.dataset.fillerCutFragment = "";
        const text = document.createTextNode(original.slice(start, end));
        element.append(text);
        replacement.append(element);
        fragments.push({ node, start, end, text, element });
      }
      for (const { start: from, end, run } of slices.sort((a, b) => a.start - b.start)) {
        keep(from);
        start = from;
        if (run.event.type === "recut") keep(end, run);
        else if (!run.parts.length) {
          const marker = document.createElement("span");
          addControl(run, marker);
          replacement.append(marker);
        }
        start = end;
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
    for (const block of foldedBlocks) foldEmptyLines(block);
  }

  return {
    control: (event: RunEvent) => starts.get(runKey(event)),
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
